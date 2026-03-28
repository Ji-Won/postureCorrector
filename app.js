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
let appState = "calibrating"; // Can be: 'calibrating', 'tracking', 'stretching'
const stretchBtn = document.getElementById('stretchBtn');

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

// --- METRICS & CHART VARIABLES ---
let totalFramesTracked = 0;
let goodFramesTracked = 0;
let sessionStartTime = null;

const chartCtx = document.getElementById('timelineChart').getContext('2d');
const timeScopeSelect = document.getElementById('timeScope');
let graphUpdateTimer = 0;
let recentRatios = []; 

// The Master Database for this session
let sessionHistory = []; 

// Initialize Chart.js
const postureChart = new Chart(chartCtx, {
    type: 'line',
    data: {
        labels: [], 
        datasets: [{
            label: 'Posture Ratio',
            data: [],
            borderColor: '#3498db',
            backgroundColor: 'rgba(52, 152, 219, 0.2)',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0 
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false, 
        scales: { y: { min: 0.5, max: 1.0 } },
        plugins: { legend: { display: false } },
        animation: { duration: 0 } 
    }
});

// 2. Event Listeners & Core Functions
timeScopeSelect.addEventListener('change', updateChartDisplay);

function updateChartDisplay() {
    const scopeVal = timeScopeSelect.value;
    let filteredHistory = sessionHistory;
    
    if (scopeVal !== 'all') {
        const cutoffTime = Date.now() - (parseInt(scopeVal) * 60 * 1000);
        filteredHistory = sessionHistory.filter(dataPoint => dataPoint.timestamp >= cutoffTime);
    }
    
    postureChart.data.labels = filteredHistory.map(dataPoint => dataPoint.timeStr);
    postureChart.data.datasets[0].data = filteredHistory.map(dataPoint => dataPoint.ratio);
    postureChart.update();
}

// Load saved threshold
const savedThreshold = localStorage.getItem('postureThreshold');
if (savedThreshold !== null) {
    slouchThreshold = parseFloat(savedThreshold);
    appState = "tracking";
    postureChart.options.scales.y.max = slouchThreshold + 0.2;
    postureChart.options.scales.y.min = slouchThreshold - 0.2;
    postureChart.update();
} else {
    appState = "calibrating";
    calibrationStartTime = Date.now();
}

recalibrateBtn.addEventListener('click', () => {
    calibrating = true;
    calibrationStartTime = Date.now();
    baselineRatios = []; 
});

stretchBtn.addEventListener('click', () => {
    if (appState !== "stretching") {
        appState = "stretching";
        stretchBtn.innerText = "Cancel Stretch";
        stretchBtn.style.backgroundColor = "#c0392b"; // Turn red to cancel
    } else {
        appState = "tracking";
        stretchBtn.innerText = "Start Stretch Break";
        stretchBtn.style.backgroundColor = "#9b59b6"; // Turn back to purple
    }
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

            if (appState === "calibrating") {
                baselineRatios.push(ratio);
                const timeLeft = Math.ceil((calibrationDuration - (Date.now() - calibrationStartTime)) / 1000);
                canvasCtx.fillStyle = "#FFFF00"; 
                canvasCtx.font = "30px Arial";
                canvasCtx.fillText(`CALIBRATING: Sit straight! (${timeLeft}s)`, 20, 50);

                if (Date.now() - calibrationStartTime > calibrationDuration) {
                    appState = "tracking"; // Automatically switch to tracking when done!
                    const avgBaseline = baselineRatios.reduce((a, b) => a + b, 0) / baselineRatios.length;
                    slouchThreshold = avgBaseline - 0.04; 
                    localStorage.setItem('postureThreshold', slouchThreshold.toString());
                    
                    postureChart.options.scales.y.max = slouchThreshold + 0.2;
                    postureChart.options.scales.y.min = slouchThreshold - 0.2;
                    postureChart.update();
                }
            } 
            // --- STATE 2: ACTIVE TRACKING ---
            else if (appState === "tracking") {
                // (Keep all your existing metrics, alerts, and master database logic here!)
                if (!sessionStartTime) sessionStartTime = Date.now();
                totalFramesTracked++;
                recentRatios.push(ratio);

                let status = "Good Posture";
                canvasCtx.fillStyle = "#00FF00"; 
                let isSlouching = false;

                if (ratio < (slouchThreshold - 0.04)) {
                    status = "SEVERE SLOUCH!"; 
                    canvasCtx.fillStyle = "#FF0000"; 
                    isSlouching = true;
                } else if (ratio < slouchThreshold) {
                    status = "WARNING (Slight Slouch)"; 
                    canvasCtx.fillStyle = "#FFA500"; 
                    isSlouching = true;
                } else {
                    goodFramesTracked++;
                }

                if (isSlouching) {
                    if (!slouchStartTime) {
                        slouchStartTime = Date.now(); lastBeepTime = 0; notificationSent = false;
                    } else {
                        const slouchDuration = (Date.now() - slouchStartTime) / 1000; 
                        if (slouchDuration >= 3 && lastBeepTime === 0 && alertsEnabled) { playSoftBeep(); lastBeepTime = Date.now(); }
                        else if (lastBeepTime > 0 && (Date.now() - lastBeepTime >= 60000) && alertsEnabled) { playSoftBeep(); lastBeepTime = Date.now(); }
                        if (slouchDuration >= 10 && !notificationSent && alertsEnabled) { sendNotification(); notificationSent = true; }
                    }
                } else { slouchStartTime = null; lastBeepTime = 0; notificationSent = false; }

                canvasCtx.font = "30px Arial"; canvasCtx.fillText(`Status: ${status}`, 20, 50);
                canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "20px Arial";
                canvasCtx.fillText(`Ratio: ${ratio.toFixed(2)} (Target: ${slouchThreshold.toFixed(2)})`, 20, 90);

                const scorePercentage = Math.round((goodFramesTracked / totalFramesTracked) * 100);
                scoreVal.innerText = `${scorePercentage}%`;
                const minutesTracked = Math.floor((Date.now() - sessionStartTime) / 60000);
                timeVal.innerText = `${minutesTracked}m`;

                if (Date.now() - graphUpdateTimer > 5000) {
                    const avgRecentRatio = recentRatios.reduce((a, b) => a + b, 0) / recentRatios.length;
                    const now = Date.now();
                    const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    sessionHistory.push({ timestamp: now, timeStr: timeLabel, ratio: avgRecentRatio });
                    if (sessionHistory.length > 8640) sessionHistory.shift(); 
                    updateChartDisplay(); 
                    graphUpdateTimer = Date.now(); recentRatios = []; 
                }
            }
            // --- STATE 3: STRETCH MODE (NEW!) ---
            else if (appState === "stretching") {
                // Dim the background slightly to show we are in a different mode
                canvasCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
                canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

                canvasCtx.fillStyle = "#9b59b6"; // Purple text
                canvasCtx.font = "bold 40px Arial";
                canvasCtx.textAlign = "center"; // Center the text easily
                canvasCtx.fillText("STRETCH MODE ACTIVE", canvasElement.width / 2, canvasElement.height / 2);
                
                canvasCtx.fillStyle = "#FFFFFF";
                canvasCtx.font = "20px Arial";
                canvasCtx.fillText("(Stretch geometry logic goes here!)", canvasElement.width / 2, canvasElement.height / 2 + 40);
                
                // Reset text alignment so it doesn't break our tracking UI later
                canvasCtx.textAlign = "left"; 
            }
        }
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#f57542', lineWidth: 4});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#f542e6', lineWidth: 2, radius: 3});
    }
    canvasCtx.restore();
}

// 4. Setup MediaPipe & Camera
const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
pose.setOptions({ 
    modelComplexity: 1, 
    smoothLandmarks: true, 
    minDetectionConfidence: 0.5, 
    minTrackingConfidence: 0.5, 
    selfieMode: true 
});
pose.onResults(onResults);

const camera = new Camera(videoElement, { 
    onFrame: async () => { await pose.send({image: videoElement}); }, 
    width: 640, 
    height: 480 
});
camera.start();