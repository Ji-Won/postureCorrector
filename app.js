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
let stretchPhase = 0; // 0: Neck 1, 1: Neck 2, 2: Shrugs, 3: Twist 1, 4: Center Reset, 5: Twist 2, 6: Victory
let stretchStartTime = null;
let accumulatedStretchTime = 0;
const targetStretchTime = 5000; 

let shrugReps = 0;
const targetShrugReps = 5;
let isCurrentlyShrugging = false; 
let firstTiltLandmark = null; // Smartly adapts to mirrored cameras

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
        firstTiltLandmark = null; // Reset the smart memory
    } else {
        appState = "tracking";
        stretchBtn.innerText = "Start Stretch Break";
        stretchBtn.style.backgroundColor = "#9b59b6"; 
        setProgressHum(false);
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

// --- SUCCESS DING (Airplane Seatbelt Sound) ---
function playSuccessDing() {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(600, audioCtx.currentTime); 
    
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5); 
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 1.5);
}

// --- ULTRA-SUBTLE PROGRESS HUM ---
let oscBase = null, oscFifth = null;
let progressGainNode = null;
let isHumming = false;

function setProgressHum(active) {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    
    if (!oscBase) {
        progressGainNode = audioCtx.createGain();
        progressGainNode.gain.setValueAtTime(0, audioCtx.currentTime); 

        // Warm, low-mid base note (F3)
        oscBase = audioCtx.createOscillator(); 
        oscBase.type = 'sine'; 
        oscBase.frequency.value = 174.61; 
        
        // Soft harmonic fifth (C4)
        oscFifth = audioCtx.createOscillator(); 
        oscFifth.type = 'sine'; 
        oscFifth.frequency.value = 261.63; 

        oscBase.connect(progressGainNode);
        oscFifth.connect(progressGainNode);
        progressGainNode.connect(audioCtx.destination);

        oscBase.start(); 
        oscFifth.start(); 
    }

    if (active && !isHumming) {
        // Volume drastically reduced to 0.03 (a whisper)
        // Fade-in time stretched to 2.5 seconds to sneak in seamlessly
        progressGainNode.gain.setTargetAtTime(0.03, audioCtx.currentTime, 2.5); 
        isHumming = true;
    } else if (!active && isHumming) {
        // Quick fade out so it doesn't linger
        progressGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.5); 
        isHumming = false;
    }
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

                // --- AR HOLOGRAPHIC GUIDES ---
                const cw = canvasElement.width;
                const ch = canvasElement.height;
                const lEarX = landmarks[7].x * cw, lEarY = landmarks[7].y * ch;
                const rEarX = landmarks[8].x * cw, rEarY = landmarks[8].y * ch;
                const lShldrX = landmarks[11].x * cw, lShldrY = landmarks[11].y * ch;
                const rShldrX = landmarks[12].x * cw, rShldrY = landmarks[12].y * ch;

                canvasCtx.lineWidth = 5;
                canvasCtx.setLineDash([10, 10]); // Dotted line effect

                if (stretchPhase === 0 || stretchPhase === 1) {
                    canvasCtx.strokeStyle = "#3498db"; 
                    // Only draw the required guide line!
                    if (stretchPhase === 0 || (stretchPhase === 1 && firstTiltLandmark === '8')) {
                        canvasCtx.beginPath(); canvasCtx.moveTo(lEarX, lEarY); canvasCtx.lineTo(lShldrX, lShldrY); canvasCtx.stroke();
                    }
                    if (stretchPhase === 0 || (stretchPhase === 1 && firstTiltLandmark === '7')) {
                        canvasCtx.beginPath(); canvasCtx.moveTo(rEarX, rEarY); canvasCtx.lineTo(rShldrX, rShldrY); canvasCtx.stroke();
                    }
                } else if (stretchPhase === 2) {
                    canvasCtx.strokeStyle = "#e67e22";
                    canvasCtx.beginPath(); canvasCtx.moveTo(lShldrX, lShldrY); canvasCtx.lineTo(lShldrX, lShldrY - 100); canvasCtx.stroke();
                    canvasCtx.beginPath(); canvasCtx.moveTo(rShldrX, rShldrY); canvasCtx.lineTo(rShldrX, rShldrY - 100); canvasCtx.stroke();
                } else if (stretchPhase === 3 || stretchPhase === 5) {
                    canvasCtx.strokeStyle = "#9b59b6";
                    canvasCtx.beginPath(); canvasCtx.moveTo(lShldrX, lShldrY); canvasCtx.lineTo(rShldrX, rShldrY); canvasCtx.stroke();
                }
                canvasCtx.setLineDash([]); 

                // --- UI DRAWING ---
                canvasCtx.textAlign = "center";
                const barWidth = 400; const barHeight = 30;
                const barX = (canvasElement.width - barWidth) / 2;

                // === PHASE 0: NECK TILT (ANY SIDE) ===
                if (stretchPhase === 0) {
                    let isTilting = false;
                    let droppedLandmark = null;

                    if ((leftEarY - rightEarY) > 0.05) { isTilting = true; droppedLandmark = '7'; }
                    else if ((rightEarY - leftEarY) > 0.05) { isTilting = true; droppedLandmark = '8'; }

                    let instruction = "Drop ONE ear to your shoulder!";
                    let subtext = "(Follow the blue lines!)";
                    let barColor = isTilting ? "#2ecc71" : "#e74c3c"; 

                    if (isTilting) {
                        // Dynamically calculate "LEFT" or "RIGHT" based purely on screen geometry!
                        let sideWord = "";
                        if (droppedLandmark === '7') sideWord = (lEarX < rEarX) ? "LEFT" : "RIGHT";
                        if (droppedLandmark === '8') sideWord = (rEarX < lEarX) ? "LEFT" : "RIGHT";

                        instruction = `Hold that ${sideWord} stretch!`; 
                        subtext = "Keep stretching...";
                        if (!stretchStartTime) stretchStartTime = Date.now();
                        accumulatedStretchTime += (Date.now() - stretchStartTime);
                        stretchStartTime = Date.now(); 
                    } else { stretchStartTime = null; }

                    let progressPct = Math.min(accumulatedStretchTime / targetStretchTime, 1.0);
                    if (progressPct >= 1.0) {
                        firstTiltLandmark = droppedLandmark; // Save the internal ID, not the word!
                        playSuccessDing(); 
                        stretchPhase = 1; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("1/5: First Neck Stretch", canvasElement.width / 2, 60);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 100);
                        canvasCtx.font = "18px Arial"; canvasCtx.fillStyle = "#bdc3c7";
                        canvasCtx.fillText(subtext, canvasElement.width / 2, 130);
                        canvasCtx.fillStyle = "#333333"; canvasCtx.fillRect(barX, 150, barWidth, barHeight);
                        canvasCtx.fillStyle = barColor; canvasCtx.fillRect(barX, 150, barWidth * progressPct, barHeight);
                    }
                }
                
                // === PHASE 1: NECK TILT (OPPOSITE SIDE) ===
                else if (stretchPhase === 1) {
                    let isTilting = false;
                    const requiredLandmark = (firstTiltLandmark === '7') ? '8' : '7';
                    
                    // Dynamically calculate the word for the opposite side
                    let requiredWord = "";
                    if (requiredLandmark === '7') requiredWord = (lEarX < rEarX) ? "LEFT" : "RIGHT";
                    if (requiredLandmark === '8') requiredWord = (rEarX < lEarX) ? "LEFT" : "RIGHT";

                    if (requiredLandmark === '7') { isTilting = (leftEarY - rightEarY) > 0.05; } 
                    else { isTilting = (rightEarY - leftEarY) > 0.05; }

                    let instruction = `Now drop your ${requiredWord} ear!`;
                    let barColor = isTilting ? "#2ecc71" : "#e74c3c"; 

                    if (isTilting) {
                        instruction = "Hold it right there!";
                        if (!stretchStartTime) stretchStartTime = Date.now();
                        accumulatedStretchTime += (Date.now() - stretchStartTime);
                        stretchStartTime = Date.now(); 
                    } else { stretchStartTime = null; }

                    let progressPct = Math.min(accumulatedStretchTime / targetStretchTime, 1.0);
                    if (progressPct >= 1.0) {
                        playSuccessDing(); 
                        stretchPhase = 2; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("2/5: Opposite Neck Stretch", canvasElement.width / 2, 60);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 100);
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
                        playSuccessDing(); stretchPhase = 3;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("3/5: Shoulder Shrugs", canvasElement.width / 2, 60);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = textColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 100);
                        canvasCtx.font = "bold 50px Arial"; canvasCtx.fillStyle = "#3498db";
                        canvasCtx.fillText(`${shrugReps} / ${targetShrugReps}`, canvasElement.width / 2, 170);
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
                        playSuccessDing(); stretchPhase = 4; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("4/5: Torso Twist", canvasElement.width / 2, 60);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 100);
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
                        playSuccessDing(); stretchPhase = 5; accumulatedStretchTime = 0; stretchStartTime = null;
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("Transition...", canvasElement.width / 2, 60);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 100);
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
                        playSuccessDing(); stretchPhase = 6; 
                    } else {
                        canvasCtx.fillStyle = "#FFFFFF"; canvasCtx.font = "bold 35px Arial";
                        canvasCtx.fillText("5/5: Opposite Torso Twist", canvasElement.width / 2, 60);
                        canvasCtx.font = "24px Arial"; canvasCtx.fillStyle = barColor;
                        canvasCtx.fillText(instruction, canvasElement.width / 2, 100);
                        canvasCtx.fillStyle = "#333333"; canvasCtx.fillRect(barX, 150, barWidth, barHeight);
                        canvasCtx.fillStyle = barColor; canvasCtx.fillRect(barX, 150, barWidth * progressPct, barHeight);
                    }
                }

                // === PHASE 6: VICTORY ===
                else if (stretchPhase === 6) {
                    canvasCtx.fillStyle = "#f1c40f"; canvasCtx.font = "bold 50px Arial";
                    canvasCtx.fillText("WORKOUT COMPLETE!", canvasElement.width / 2, canvasElement.height / 2);
                    canvasCtx.font = "20px Arial"; canvasCtx.fillStyle = "#FFFFFF";
                    canvasCtx.fillText("Click 'Cancel Stretch' to resume tracking", canvasElement.width / 2, canvasElement.height / 2 + 50);
                }

                // === PROGRESS HUM CONTROLLER ===
                // If we are in a holding phase (not shrugs, not victory) AND the timer is running...
                if (stretchPhase !== 2 && stretchPhase !== 6 && stretchStartTime !== null) {
                    setProgressHum(true); // Turn the EV engine on!
                } else {
                    setProgressHum(false); // Fade it out
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