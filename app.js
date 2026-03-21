// 1. Grab HTML elements
const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const recalibrateBtn = document.getElementById('recalibrateBtn');
const alertBtn = document.getElementById('alertBtn'); 

// --- VARIABLES ---
let calibrating = false;
let calibrationStartTime = 0;
const calibrationDuration = 5000;
let baselineRatios = [];
let slouchThreshold = 0.0;

// --- ALERT VARIABLES ---
let audioCtx;
let alertsEnabled = false;
let slouchStartTime = null;
let lastBeepTime = 0; // NEW: Tracks when the last beep happened
let notificationSent = false;

// Load saved threshold
const savedThreshold = localStorage.getItem('postureThreshold');
if (savedThreshold !== null) {
    slouchThreshold = parseFloat(savedThreshold);
} else {
    calibrating = true;
    calibrationStartTime = Date.now();
}

// 2. Buttons
recalibrateBtn.addEventListener('click', () => {
    calibrating = true;
    calibrationStartTime = Date.now();
    baselineRatios = []; 
});

alertBtn.addEventListener('click', async () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    if ("Notification" in window) {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            alertsEnabled = true;
            alertBtn.innerText = "Alerts Active";
            alertBtn.style.backgroundColor = "#27ae60"; 
        } else {
            alert("Notification permission denied by browser.");
        }
    }
});

function playSoftBeep() {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); 
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.0);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 1.0);
}

function sendNotification() {
    if (Notification.permission === 'granted') {
        new Notification("Posture Alert!", {
            body: "You've been slouching for 10 seconds. Time to sit up!",
            icon: "https://cdn-icons-png.flaticon.com/512/190/190411.png" 
        });
    }
}

// 3. Main AI Loop
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        const landmarks = results.poseLandmarks;
        const leftEarY = landmarks[7].y, rightEarY = landmarks[8].y;
        const leftShoulderY = landmarks[11].y, rightShoulderY = landmarks[12].y;
        const leftShoulderX = landmarks[11].x, rightShoulderX = landmarks[12].x;

        const avgEarY = (leftEarY + rightEarY) / 2.0;
        const avgShoulderY = (leftShoulderY + rightShoulderY) / 2.0;
        const neckHeight = avgShoulderY - avgEarY;
        const shoulderWidth = Math.abs(leftShoulderX - rightShoulderX);

        if (shoulderWidth > 0) {
            const ratio = neckHeight / shoulderWidth;

            if (calibrating) {
                baselineRatios.push(ratio);
                const timeLeft = Math.ceil((calibrationDuration - (Date.now() - calibrationStartTime)) / 1000);
                
                canvasCtx.fillStyle = "#FFFF00";
                canvasCtx.font = "30px Arial";
                canvasCtx.fillText(`CALIBRATING: Sit straight! (${timeLeft}s)`, 20, 50);

                if (Date.now() - calibrationStartTime > calibrationDuration) {
                    calibrating = false;
                    const avgBaseline = baselineRatios.reduce((a, b) => a + b, 0) / baselineRatios.length;
                    slouchThreshold = avgBaseline - 0.04; 
                    localStorage.setItem('postureThreshold', slouchThreshold.toString());
                }
            } 
            else {
                let status = "Good Posture";
                canvasCtx.fillStyle = "#00FF00"; 

                // --- UPDATED: RECURRING ALERT LOGIC ---
                if (ratio < slouchThreshold) {
                    status = "SLOUCHING!";
                    canvasCtx.fillStyle = "#FF0000"; 
                    
                    if (!slouchStartTime) {
                        slouchStartTime = Date.now(); 
                        lastBeepTime = 0; // Reset beep tracker
                        notificationSent = false;
                    } else {
                        const slouchDuration = (Date.now() - slouchStartTime) / 1000; 
                        
                        // Initial Beep at 3 seconds
                        if (slouchDuration >= 3 && lastBeepTime === 0 && alertsEnabled) {
                            playSoftBeep();
                            lastBeepTime = Date.now();
                        }
                        // Recurring Beep every 60 seconds (60000 ms)
                        else if (lastBeepTime > 0 && (Date.now() - lastBeepTime >= 60000) && alertsEnabled) {
                            playSoftBeep();
                            lastBeepTime = Date.now();
                        }
                        
                        // OS Notification at 10 seconds (still only happens once per slouch)
                        if (slouchDuration >= 10 && !notificationSent && alertsEnabled) {
                            sendNotification();
                            notificationSent = true;
                        }
                    }
                } else {
                    // Reset all timers if posture is corrected
                    slouchStartTime = null;
                    lastBeepTime = 0;
                    notificationSent = false;
                }

                canvasCtx.font = "30px Arial";
                canvasCtx.fillText(`Status: ${status}`, 20, 50);
                canvasCtx.fillStyle = "#FFFFFF"; 
                canvasCtx.font = "20px Arial";
                canvasCtx.fillText(`Ratio: ${ratio.toFixed(2)}`, 20, 90);
            }
        }

        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#f57542', lineWidth: 4});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#f542e6', lineWidth: 2, radius: 3});
    }
    canvasCtx.restore();
}

// 4. Setup
const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5, selfieMode: true });
pose.onResults(onResults);

const camera = new Camera(videoElement, { onFrame: async () => { await pose.send({image: videoElement}); }, width: 640, height: 480 });
camera.start();