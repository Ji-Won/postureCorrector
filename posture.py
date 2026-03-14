import cv2
import mediapipe as mp
import time
import json
import os

# --- PERSISTENT MEMORY SETUP ---
CONFIG_FILE = "config.json"

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f).get('threshold', None)
    return None

def save_config(threshold):
    with open(CONFIG_FILE, 'w') as f:
        json.dump({'threshold': threshold}, f)

# 1. Setup MediaPipe
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)
mp_draw = mp.solutions.drawing_utils

cap = cv2.VideoCapture(0)

# --- CALIBRATION VARIABLES ---
calibration_duration = 5
baseline_ratios = []

# Check if we already have a saved threshold
saved_threshold = load_config()
if saved_threshold is not None:
    slouch_threshold = saved_threshold
    calibrating = False
    print(f"Loaded saved threshold: {slouch_threshold:.2f}")
else:
    slouch_threshold = 0.0
    calibrating = True
    calibration_start = time.time()
    print("No save found. Starting calibration...")

while cap.isOpened():
    success, image = cap.read()
    if not success: continue

    image = cv2.flip(image, 1)
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = pose.process(image_rgb)

    if results.pose_landmarks:
        landmarks = results.pose_landmarks.landmark
        
        # Get Coordinates
        left_ear_y, right_ear_y = landmarks[7].y, landmarks[8].y
        left_shoulder_y, right_shoulder_y = landmarks[11].y, landmarks[12].y
        left_shoulder_x, right_shoulder_x = landmarks[11].x, landmarks[12].x
        
        # Calculate Math
        avg_ear_y = (left_ear_y + right_ear_y) / 2.0
        avg_shoulder_y = (left_shoulder_y + right_shoulder_y) / 2.0
        neck_height = avg_shoulder_y - avg_ear_y
        shoulder_width = abs(left_shoulder_x - right_shoulder_x)
        
        if shoulder_width > 0:
            ratio = neck_height / shoulder_width
            
            # --- PHASE 1: CALIBRATION ---
            if calibrating:
                baseline_ratios.append(ratio)
                time_left = int(calibration_duration - (time.time() - calibration_start))
                
                cv2.putText(image, f"CALIBRATING: Sit straight! ({time_left}s)", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 3)
                
                if time.time() - calibration_start > calibration_duration:
                    calibrating = False
                    avg_baseline = sum(baseline_ratios) / len(baseline_ratios)
                    
                    # Set your sensitivity here (e.g., 0.04)
                    slouch_threshold = avg_baseline - 0.06 
                    
                    # Save it to the file!
                    save_config(slouch_threshold)
                    print(f"Calibration saved! Threshold: {slouch_threshold:.2f}")
            
            # --- PHASE 2: ACTIVE TRACKING ---
            else:
                status = "Good Posture"
                color = (0, 255, 0) # Green
                
                if ratio < slouch_threshold: 
                    status = "SLOUCHING!"
                    color = (0, 0, 255) # Red
                
                cv2.putText(image, f"Status: {status}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 3)
                cv2.putText(image, f"Ratio: {ratio:.2f} (Target: {slouch_threshold:.2f})", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                cv2.putText(image, "Press 'r' to recalibrate", (20, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
        
        mp_draw.draw_landmarks(image, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

    cv2.imshow('Posture Corrector', image)

    # --- KEYBOARD CONTROLS ---
    key = cv2.waitKey(5) & 0xFF
    if key == ord('q'):
        break
    elif key == ord('r'): # The new Recalibrate button!
        print("Recalibrating...")
        calibrating = True
        calibration_start = time.time()
        baseline_ratios = [] # Clear the old data
        
    try:
        if cv2.getWindowProperty('Posture Corrector', cv2.WND_PROP_VISIBLE) < 1: break
    except: pass

cap.release()
cv2.destroyAllWindows()