# 🧘 AI Posture Corrector & Stretch Assistant

A browser-based AI computer vision application that tracks your posture in real-time, visualizes your habits, and enforces healthy desk routines through gamified, AR-guided stretch breaks. 

Built entirely with frontend technologies, the AI model runs 100% locally in your browser. No video data is ever recorded or sent to a server, ensuring complete privacy.

## ✨ Features

* **Real-Time AI Tracking:** Uses Google's MediaPipe to map 33 body landmarks and mathematically calculate your posture ratio (neck height vs. shoulder width).
* **Smart State Machine:** Seamlessly transitions between `calibrating`, `tracking`, and `stretching` modes.
* **Gamified Stretch Routine:** A 5-phase interactive workout (Neck Tilts, Shoulder Shrugs, Torso Twists) that only advances when you hold the correct angles.
* **Holographic AR Guides:** Draws dynamic, glowing UI elements directly onto your body to guide your stretches.
* **Pomodoro Auto-Trigger:** Automatically drops a reminder banner and OS notification every 50 minutes to remind you to take a screen break.
* **Ambient Audio Engine:** Uses the Web Audio API to synthesize ethereal, meditative chord swells (Middle C/G/Octave) to provide eyes-free feedback while you hold stretches.
* **Live Data Visualization:** Uses Chart.js to plot your posture ratio on a timeline, allowing you to review your habits over the last 5 minutes, 15 minutes, or 1 hour.

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript
* **AI / Computer Vision:** Google MediaPipe (Pose Detection)
* **Data Visualization:** Chart.js
* **Audio / Notifications:** Web Audio API, Web Notifications API

## 🚀 Live Demo

[Play the Live Demo Here!](https://ji-won.github.io/postureCorrector/)
*(Note: Be sure to grant camera permissions when prompted. The model may take a few seconds to load initially.)*

## 💻 Local Development Setup

Because this app uses modern browser features like Web Audio and Desktop Notifications, it cannot be run by simply double-clicking the `index.html` file (browsers block these features on `file:///` protocols for security). You must run it through a local server.

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/](https://github.com/)Ji-Won/postureCorrector.git
   cd postureCorrector