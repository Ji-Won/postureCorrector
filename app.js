// 1. Grab the HTML elements
const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const recalibrateBtn = document.getElementById('recalibrateBtn');

// --- CALIBRATION VARIABLES ---
let calibrating = false;
let calibrationStartTime = 0;
const calibrationDuration = 5000; // 5 seconds (in milliseconds)
let baselineRatios = [];
let slouchThreshold = 0.0;

// Check Local Storage for a saved threshold (The Web version of config.json)
const savedThreshold = localStorage.getItem('postureThreshold');
if (savedThreshold !== null) {
    slouchThreshold = parseFloat(savedThreshold);
    console.log("Loaded saved threshold: " + slouchThreshold.toFixed(2));
} else {
    calibrating = true;
    calibrationStartTime = Date.now();
    console.log("No save found. Starting calibration...");
}

// 2. The Recalibrate Button Logic
recalibrateBtn.addEventListener('click', () => {
    console.log("Recalibrating...");
    calibrating = true;
    calibrationStartTime = Date.now();
    baselineRatios = []; // Clear the old data
});

// 3. The Main Processing Function (Runs every time the webcam gets a new frame)
function onResults(results) {
    // Clear the canvas and draw the raw video frame
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        const landmarks = results.poseLandmarks;
        
        // Get Coordinates (7 & 8 are ears, 11 & 12 are shoulders)
        const leftEarY = landmarks[7].y;
        const rightEarY = landmarks[8].y;
        const leftShoulderY = landmarks[11].y;
        const rightShoulderY = landmarks[12].y;
        
        const leftShoulderX = landmarks[11].x;
        const rightShoulderX = landmarks[12].x;

        // Calculate Math
        const avgEarY = (leftEarY + rightEarY) / 2.0;
        const avgShoulderY = (leftShoulderY + rightShoulderY) / 2.0;
        
        const neckHeight = avgShoulderY - avgEarY;
        const shoulderWidth = Math.abs(leftShoulderX - rightShoulderX);

        if (shoulderWidth > 0) {
            const ratio = neckHeight / shoulderWidth;

            // --- PHASE 1: CALIBRATION ---
            if (calibrating) {
                baselineRatios.push(ratio);
                const timeLeft = Math.ceil((calibrationDuration - (Date.now() - calibrationStartTime)) / 1000);
                
                // Draw Yellow Calibration Text
                canvasCtx.fillStyle = "#FFFF00";
                canvasCtx.font = "30px Arial";
                canvasCtx.fillText(`CALIBRATING: Sit straight! (${timeLeft}s)`, 20, 50);

                if (Date.now() - calibrationStartTime > calibrationDuration) {
                    calibrating = false;
                    const avgBaseline = baselineRatios.reduce((a, b) => a + b, 0) / baselineRatios.length;
                    
                    // Set sensitivity (matching your Python code)
                    slouchThreshold = avgBaseline - 0.04; 
                    
                    // Save to Local Storage!
                    localStorage.setItem('postureThreshold', slouchThreshold.toString());
                    console.log("Calibration saved! Threshold: " + slouchThreshold.toFixed(2));
                }
            } 
            // --- PHASE 2: ACTIVE TRACKING ---
            else {
                let status = "Good Posture";
                canvasCtx.fillStyle = "#00FF00"; // Green

                if (ratio < slouchThreshold) {
                    status = "SLOUCHING!";
                    canvasCtx.fillStyle = "#FF0000"; // Red
                }

                // Draw Status and Ratio Text
                canvasCtx.font = "30px Arial";
                canvasCtx.fillText(`Status: ${status}`, 20, 50);
                
                canvasCtx.fillStyle = "#FFFFFF"; // White
                canvasCtx.font = "20px Arial";
                canvasCtx.fillText(`Ratio: ${ratio.toFixed(2)} (Target: ${slouchThreshold.toFixed(2)})`, 20, 90);
            }
        }

        // Draw the digital skeleton using Google's drawing_utils
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#f57542', lineWidth: 4});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#f542e6', lineWidth: 2, radius: 3});
    }
    canvasCtx.restore();
}

// 4. Setup MediaPipe AI
const pose = new Pose({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
}});
pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    selfieMode: true // Automatically mirrors the webcam!
});
pose.onResults(onResults);

// 5. Start the Webcam
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({image: videoElement});
    },
    width: 640,
    height: 480
});
camera.start();