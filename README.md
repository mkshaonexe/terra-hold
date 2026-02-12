# 🌍 TerraHold

**Interactive 3D Earth AR visualization with real-time hand tracking.**

Control a photorealistic 3D Earth globe floating above your hand — using just your webcam and bare hands. No VR headset, no installs, runs entirely in the browser.

---

## ✨ Features

- 🎥 **Webcam AR** — Live camera feed as the background
- 🌐 **Photorealistic Earth** — NASA Blue Marble textures with bump mapping, clouds, and atmospheric glow
- 🤚 **Left Hand → Position** — Earth floats above your left palm and follows it in real-time
- 🤏 **Right Hand → Scale & Rotate** — Pinch to resize, open hand to rotate the globe
- ⚡ **Real-time** — 30+ FPS hand tracking powered by MediaPipe
- 🎨 **Premium UI** — Glassmorphic HUD with loading animation and instructions overlay

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| 3D Rendering | [Three.js](https://threejs.org/) |
| Hand Tracking | [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands) |
| Camera | WebRTC `getUserMedia` |
| Frontend | Vanilla HTML + CSS + JS |
| Hosting | GitHub Pages |

---

## 🚀 Getting Started

### Live Demo
👉 [**terra-hold on GitHub Pages**](https://mkshaonexe.github.io/terra-hold/)
*(Recommended — avoiding browser security restrictions)*

### Run Locally
**Note:** Opening `index.html` directly (file://) may block hand tracking due to browser security policies.

1. Clone the repo:
   ```bash
   git clone https://github.com/mkshaonexe/terra-hold.git
   cd terra-hold
   ```
2. Start a local server:
   ```bash
   npx serve .
   ```
3. Open `http://localhost:3000` in **Chrome**.

---

## 🎮 Controls

| Hand | Gesture | Action |
|------|---------|--------|
| Left | Open palm | Position the Earth |
| Right | Pinch (thumb + index) | Scale up/down |
| Right | Open hand + move | Rotate the Earth |

---

## ❓ Troubleshooting

**"I can see myself but no Earth?"**
- Ensure you are using the **Live Demo** or a **Local Server** (not opening the file directly).
- Raise your **LEFT HAND** to spawn the Earth.
- Ensure your hand is clearly visible and well-lit.
- Check if the "Left Hand" indicator in the HUD is lit up.

---

## 📁 Project Structure

```
terra-hold/
├── index.html          # Entry point
├── css/
│   └── style.css       # Glassmorphic UI styles
├── js/
│   ├── app.js          # Main orchestrator
│   ├── earth.js        # Three.js Earth rendering
│   └── hands.js        # MediaPipe hand tracking
└── README.md
```

---

## 📝 License

MIT License — feel free to use, modify, and share.

---

Made with ✨ by [@mkshaonexe](https://github.com/mkshaonexe)
