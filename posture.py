import cv2
import mediapipe as mp
import numpy as np
import math

# 1. Setup MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)
mp_draw = mp.solutions.drawing_utils

# 2. Start Camera
cap = cv2.VideoCapture(0)
print("Starting Posture Corrector...")

while cap.isOpened():
    success, image = cap.read()
    if not success: continue

    # Mirror the image 
    image = cv2.flip(image, 1)
    h, w, c = image.shape
    
    # Process the AI
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = pose.process(image_rgb)

    # Default status
    status = "Good Posture"
    color = (0, 255, 0) # Green
    ratio = 0.0

    # 3. Analyze Posture
    if results.pose_landmarks:
        landmarks = results.pose_landmarks.landmark
        
        # Get Coordinates for Ears and Shoulders (y is vertical, x is horizontal)
        left_ear_y = landmarks[7].y
        right_ear_y = landmarks[8].y
        left_shoulder_y = landmarks[11].y
        right_shoulder_y = landmarks[12].y
        
        left_shoulder_x = landmarks[11].x
        right_shoulder_x = landmarks[12].x
        
        # Calculate Averages (to make it stable)
        avg_ear_y = (left_ear_y + right_ear_y) / 2.0
        avg_shoulder_y = (left_shoulder_y + right_shoulder_y) / 2.0
        
        # Measure Distances
        # Note: In OpenCV, Y=0 is the TOP of the screen, so shoulder_y is a BIGGER number than ear_y
        neck_height = avg_shoulder_y - avg_ear_y
        shoulder_width = abs(left_shoulder_x - right_shoulder_x)
        
        # Calculate the Posture Ratio
        if shoulder_width > 0:
            ratio = neck_height / shoulder_width
            
            # --- THE SLOUCH THRESHOLD ---
            # If the neck height is too short compared to the shoulders, you are slouching!
            # (We will calibrate this number together)
            if ratio < 0.40: 
                status = "SLOUCHING!"
                color = (0, 0, 255) # Red
        
        # Draw the skeleton
        mp_draw.draw_landmarks(image, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

    # 4. Display the Data on Screen
    cv2.putText(image, f"Status: {status}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 3)
    cv2.putText(image, f"Posture Ratio: {ratio:.2f}", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

    cv2.imshow('Posture Corrector', image)

    if cv2.waitKey(5) & 0xFF == ord('q'):
        break
        
    try:
        if cv2.getWindowProperty('Posture Corrector', cv2.WND_PROP_VISIBLE) < 1:
            break
    except: pass

cap.release()
cv2.destroyAllWindows()