// 1. Grab HTML elements
const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const recalibrateBtn = document.getElementById('recalibrateBtn');
const alertBtn = document.getElementById('alertBtn'); 

// Dashboard Elements
const scoreVal = document.getElementById('scoreVal');
const timeVal = document.getElementById('timeVal');

// --- VARIABLES ---
let calibrating = false;
let calibrationStartTime = 0;
const calibrationDuration = 5000;
let baselineRatios = [];
let slouchThreshold = 0.0;

// Alert Variables
let audioCtx;
let alertsEnabled = false;
let slouchStartTime = null;
let lastBeepTime = 0; 
let notificationSent = false;

// --- NEW: METRICS VARIABLES ---
let totalFramesTracked = 0;
let goodFramesTracked = 0;
let sessionStartTime = null;

// --- NEW: CHART SETUP ---
const chartCtx = document.getElementById('timelineChart').getContext('2d');
let graphUpdateTimer = 0;
let recentRatios = []; // Holds ratios over a 5-second window to average out the graph

const postureChart = new Chart(chartCtx, {
    type: 'line',
    data: {
        labels: [], // Time stamps
        datasets: [{
            label: 'Posture Ratio',
            data: [],
            borderColor: '#3498db',
            backgroundColor: 'rgba(52, 152, 219, 0.2)',
            borderWidth: 2,
            fill: true,
            tension: 0.4 // Gives it a smooth curve
        }]
    },
    options: {
        responsive: true,
        scales: {
            y: { min: 0.5, max: 1.0 } // Keeps the graph scale locked for consistency
        },
        plugins: { legend: { display: false } }
    }
});

// Load saved threshold
const savedThreshold = localStorage.getItem('postureThreshold');
if (savedThreshold !== null) {
    slouchThreshold = parseFloat(savedThreshold);
} else {
    calibrating = true;
    calibrationStartTime = Date.now();
}

// Buttons
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
        new Notification("Posture Alert!", { body: "You've been slouching for 10 seconds. Time to sit up!" });
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
                    
                    // NEW: Dynamically adjust the graph's Y-axis to fit the user
                    postureChart.options.scales.y.max = slouchThreshold + 0.2;
                    postureChart.options.scales.y.min = slouchThreshold - 0.2;
                    postureChart.update();
                }
            } 
            else {
                // --- METRICS TRACKING ---
                if (!sessionStartTime) sessionStartTime = Date.now();
                totalFramesTracked++;
                recentRatios.push(ratio);

                let status = "Good Posture";
                canvasCtx.fillStyle = "#00FF00"; 
                let isSlouching = false;

                // --- SEVERITY TRACKING ---
                if (ratio < (slouchThreshold - 0.04)) {
                    // SEVERE SLOUCH (Drops deeply below the threshold)
                    status = "SEVERE SLOUCH!";
                    canvasCtx.fillStyle = "#FF0000"; // Red
                    isSlouching = true;
                } 
                else if (ratio < slouchThreshold) {
                    // WARNING (Just dipped below the threshold)
                    status = "WARNING (Slight Slouch)";
                    canvasCtx.fillStyle = "#FFA500"; // Orange
                    isSlouching = true;
                } 
                else {
                    // GOOD
                    goodFramesTracked++;
                }

                // ALERT LOGIC
                if (isSlouching) {
                    if (!slouchStartTime) {
                        slouchStartTime = Date.now(); 
                        lastBeepTime = 0; notificationSent = false;
                    } else {
                        const slouchDuration = (Date.now() - slouchStartTime) / 1000; 
                        if (slouchDuration >= 3 && lastBeepTime === 0 && alertsEnabled) {
                            playSoftBeep(); lastBeepTime = Date.now();
                        }
                        else if (lastBeepTime > 0 && (Date.now() - lastBeepTime >= 60000) && alertsEnabled) {
                            playSoftBeep(); lastBeepTime = Date.now();
                        }
                        if (slouchDuration >= 10 && !notificationSent && alertsEnabled) {
                            sendNotification(); notificationSent = true;
                        }
                    }
                } else {
                    slouchStartTime = null; lastBeepTime = 0; notificationSent = false;
                }

                // DRAW CANVAS TEXT
                canvasCtx.font = "30px Arial";
                canvasCtx.fillText(`Status: ${status}`, 20, 50);
                canvasCtx.fillStyle = "#FFFFFF"; 
                canvasCtx.font = "20px Arial";
                canvasCtx.fillText(`Ratio: ${ratio.toFixed(2)} (Target: ${slouchThreshold.toFixed(2)})`, 20, 90);

                // --- UPDATE UI DASHBOARD ---
                const scorePercentage = Math.round((goodFramesTracked / totalFramesTracked) * 100);
                scoreVal.innerText = `${scorePercentage}%`;
                
                const minutesTracked = Math.floor((Date.now() - sessionStartTime) / 60000);
                timeVal.innerText = `${minutesTracked}m`;

                // --- UPDATE CHART EVERY 5 SECONDS ---
                if (Date.now() - graphUpdateTimer > 5000) {
                    // Get the average ratio over the last 5 seconds to smooth the line
                    const avgRecentRatio = recentRatios.reduce((a, b) => a + b, 0) / recentRatios.length;
                    
                    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    postureChart.data.labels.push(timeLabel);
                    postureChart.data.datasets[0].data.push(avgRecentRatio);

                    // Keep only the last 20 data points on the graph so it doesn't get cluttered
                    if (postureChart.data.labels.length > 20) {
                        postureChart.data.labels.shift();
                        postureChart.data.datasets[0].data.shift();
                    }
                    postureChart.update();
                    
                    graphUpdateTimer = Date.now();
                    recentRatios = []; // Reset for the next 5 seconds
                }
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