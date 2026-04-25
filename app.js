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

// Stretch Routine Variables
let stretchPhase = 0; // 0: Neck L, 1: Neck R, 2: Shrugs, 3: Twist 1, 4: Center Reset, 5: Twist 2, 6: Victory
let stretchStartTime = null;
let accumulatedStretchTime = 0;
const targetStretchTime = 5000; // 5 seconds for holds

let shrugReps = 0;
const targetShrugReps = 5;
let isCurrentlyShrugging = false;

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
    // NEW: Ensure audio is unlocked when starting a stretch so the ding plays!
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (appState !== "stretching") {
        appState = "stretching";
        stretchBtn.innerText = "Cancel Stretch";
        stretchBtn.style.backgroundColor = "#c0392b"; 
        
        stretchPhase = 0;
        accumulatedStretchTime = 0;
        stretchStartTime = null;
        shrugReps = 0;
        isCurrentlyShrugging = false;
    } else {
        appState = "tracking";
        stretchBtn.innerText = "Start Stretch Break";
        stretchBtn.style.backgroundColor = "#9b59b6"; 
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

// --- NEW: SUCCESS DING (Airplane Seatbelt Sound) ---
function playSuccessDing() {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(600, audioCtx.currentTime); // 600Hz is a classic pleasant chime
    
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5); // Smooth fade out
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 1.5);
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
            // --- STATE 3: STRETCH MODE ---
            else if (appState === "stretching") {
                canvasCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
                canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
                canvasCtx.textAlign = "center";

                const barWidth = 400; const barHeight = 30;
                const barX = (canvasElement.width - barWidth) / 2;

                // === PHASE 0: NECK TILT (LEFT) ===
                if (stretchPhase === 0) {
                    const isTiltingLeft = (rightEarY - leftEarY) > 0.05; 
                    let instruction = "Tilt your head LEFT!";
                    let barColor = isTiltingLeft ? "#2ecc71" : "#e74c3c"; 

                    if (isTiltingLeft) {
                        instruction = "Hold it right there!";
                        if (!stretchStartTime) stretchStartTime = Date.now();
                        accumulatedStretchTime += (Date.now() - stretchStartTime);
                        stretchStartTime = Date.now(); 
                    } else { stretchStartTime = null; }

                    let progressPct = Math.min(accumulatedStretchTime / targetStretchTime, 1.0);
                    if (progressPct >= 1.0) {
                        playSuccessDing(); // DING!
                        stretchPhase = 1; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("1/5: Left Neck Stretch", canvasElement.width / 2, 80);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 120);
                        canvasCtx.fillStyle = "#333333"; canvasCtx.fillRect(barX, 150, barWidth, barHeight);
                        canvasCtx.fillStyle = barColor; canvasCtx.fillRect(barX, 150, barWidth * progressPct, barHeight);
                    }
                }
                
                // === PHASE 1: NECK TILT (RIGHT) ===
                else if (stretchPhase === 1) {
                    const isTiltingRight = (leftEarY - rightEarY) > 0.05; 
                    let instruction = "Now tilt your head RIGHT!";
                    let barColor = isTiltingRight ? "#2ecc71" : "#e74c3c"; 

                    if (isTiltingRight) {
                        instruction = "Hold it right there!";
                        if (!stretchStartTime) stretchStartTime = Date.now();
                        accumulatedStretchTime += (Date.now() - stretchStartTime);
                        stretchStartTime = Date.now(); 
                    } else { stretchStartTime = null; }

                    let progressPct = Math.min(accumulatedStretchTime / targetStretchTime, 1.0);
                    if (progressPct >= 1.0) {
                        playSuccessDing(); // DING!
                        stretchPhase = 2; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("2/5: Right Neck Stretch", canvasElement.width / 2, 80);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 120);
                        canvasCtx.fillStyle = "#333333"; canvasCtx.fillRect(barX, 150, barWidth, barHeight);
                        canvasCtx.fillStyle = barColor; canvasCtx.fillRect(barX, 150, barWidth * progressPct, barHeight);
                    }
                }

                // === PHASE 2: SHOULDER SHRUGS ===
                else if (stretchPhase === 2) {
                    const isShrugging = neckHeight < 0.24; 
                    let instruction = "Shrug your shoulders UP!";
                    let textColor = isShrugging ? "#2ecc71" : "#e74c3c";

                    if (isShrugging) {
                        instruction = "Drop them DOWN!";
                        if (!isCurrentlyShrugging) { isCurrentlyShrugging = true; shrugReps++; }
                    } else { isCurrentlyShrugging = false; }

                    if (shrugReps >= targetShrugReps) {
                        playSuccessDing(); // DING!
                        stretchPhase = 3;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("3/5: Shoulder Shrugs", canvasElement.width / 2, 80);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = textColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 120);
                        canvasCtx.font = "bold 50px Arial"; canvasCtx.fillStyle = "#3498db";
                        canvasCtx.fillText(`${shrugReps} / ${targetShrugReps}`, canvasElement.width / 2, 190);
                    }
                }

                // === PHASE 3: TORSO TWIST (SIDE 1) ===
                else if (stretchPhase === 3) {
                    const isTwisting = shoulderWidth < 0.15; 
                    let instruction = "Twist to ONE side!";
                    let barColor = isTwisting ? "#2ecc71" : "#e74c3c"; 

                    if (isTwisting) {
                        instruction = "Hold the twist!";
                        if (!stretchStartTime) stretchStartTime = Date.now();
                        accumulatedStretchTime += (Date.now() - stretchStartTime);
                        stretchStartTime = Date.now(); 
                    } else { stretchStartTime = null; }

                    let progressPct = Math.min(accumulatedStretchTime / targetStretchTime, 1.0);
                    if (progressPct >= 1.0) {
                        playSuccessDing(); // DING!
                        stretchPhase = 4; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("4/5: Torso Twist", canvasElement.width / 2, 80);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 120);
                        canvasCtx.fillStyle = "#333333"; canvasCtx.fillRect(barX, 150, barWidth, barHeight);
                        canvasCtx.fillStyle = barColor; canvasCtx.fillRect(barX, 150, barWidth * progressPct, barHeight);
                    }
                }

                // === PHASE 4: CENTER RESET (TRANSITION) ===
                else if (stretchPhase === 4) {
                    const isCentered = shoulderWidth > 0.25; 
                    let instruction = "Face forward to reset!";
                    let barColor = isCentered ? "#3498db" : "#e74c3c"; 

                    if (isCentered) {
                        if (!stretchStartTime) stretchStartTime = Date.now();
                        accumulatedStretchTime += (Date.now() - stretchStartTime);
                        stretchStartTime = Date.now(); 
                    } else { stretchStartTime = null; }

                    let progressPct = Math.min(accumulatedStretchTime / 1500, 1.0);
                    if (progressPct >= 1.0) {
                        playSuccessDing(); // DING!
                        stretchPhase = 5; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("Transition...", canvasElement.width / 2, 80);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 120);
                        canvasCtx.fillStyle = "#333333"; canvasCtx.fillRect(barX, 150, barWidth, barHeight);
                        canvasCtx.fillStyle = barColor; canvasCtx.fillRect(barX, 150, barWidth * progressPct, barHeight);
                    }
                }

                // === PHASE 5: TORSO TWIST (SIDE 2) ===
                else if (stretchPhase === 5) {
                    const isTwisting = shoulderWidth < 0.15; 
                    let instruction = "Twist to the OTHER side!";
                    let barColor = isTwisting ? "#2ecc71" : "#e74c3c"; 

                    if (isTwisting) {
                        instruction = "Hold the twist!";
                        if (!stretchStartTime) stretchStartTime = Date.now();
                        accumulatedStretchTime += (Date.now() - stretchStartTime);
                        stretchStartTime = Date.now(); 
                    } else { stretchStartTime = null; }

                    let progressPct = Math.min(accumulatedStretchTime / targetStretchTime, 1.0);
                    if (progressPct >= 1.0) {
                        playSuccessDing(); // DING! (Final Victory Ding!)
                        stretchPhase = 6; 
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("5/5: Torso Twist", canvasElement.width / 2, 80);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 120);
                        canvasCtx.fillStyle = "#333333"; canvasCtx.fillRect(barX, 150, barWidth, barHeight);
                        canvasCtx.fillStyle = barColor; canvasCtx.fillRect(barX, 150, barWidth * progressPct, barHeight);
                    }
                }

                // === PHASE 6: VICTORY ===
                else if (stretchPhase === 6) {
                    canvasCtx.fillStyle = "#f1c40f"; 
                    canvasCtx.font = "bold 50px Arial";
                    canvasCtx.fillText("WORKOUT COMPLETE!", canvasElement.width / 2, canvasElement.height / 2);
                    canvasCtx.font = "20px Arial"; canvasCtx.fillStyle = "#FFFFFF";
                    canvasCtx.fillText("Click 'Cancel Stretch' to resume tracking", canvasElement.width / 2, canvasElement.height / 2 + 50);
                }

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