const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-wasm");
const poseDetection = require("@tensorflow-models/pose-detection");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto"); // FIXED: Replaced 'uuid' with native crypto
const sharp = require("sharp"); 

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 8080;

// --- PHYSICS ENGINE (Ported from Python YabuResearchEngine) ---
// 1. OneEuroFilter Class
class OneEuroFilter {
  constructor(mincutoff = 1.0, beta = 0.0, dcutoff = 1.0) {
    this.mincutoff = mincutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
    this.x_prev = null;
    this.dx_prev = null;
    this.t_prev = null;
  }

  filter(x, t) {
    if (this.t_prev === null) {
      this.t_prev = t;
      this.x_prev = x;
      this.dx_prev = 0;
      return x;
    }
    const dt = t - this.t_prev;
    if (dt <= 0) return this.x_prev;

    const dx = (x - this.x_prev) / dt;
    const a_d = this.smoothingFactor(dt, this.dcutoff);
    const dx_hat = a_d * dx + (1 - a_d) * this.dx_prev;

    const cutoff = this.mincutoff + this.beta * Math.abs(dx_hat);
    const a = this.smoothingFactor(dt, cutoff);
    const x_hat = a * x + (1 - a) * this.x_prev;

    this.x_prev = x_hat;
    this.dx_prev = dx_hat;
    this.t_prev = t;
    return x_hat;
  }

  smoothingFactor(dt, cutoff) {
    const r = 2 * Math.PI * cutoff * dt;
    return r / (r + 1);
  }
}

// 2. Vector Math Helpers
function dist(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function angleBetween(a, b, c) {
  const BA = { x: a.x - b.x, y: a.y - b.y };
  const BC = { x: c.x - b.x, y: c.y - b.y };
  
  const dot = BA.x * BC.x + BA.y * BC.y;
  const magBA = Math.sqrt(BA.x*BA.x + BA.y*BA.y);
  const magBC = Math.sqrt(BC.x*BC.x + BC.y*BC.y);
  
  if (magBA === 0 || magBC === 0) return 0;
  
  let cosine = dot / (magBA * magBC);
  cosine = Math.max(-1, Math.min(1, cosine));
  return Math.acos(cosine) * (180 / Math.PI);
}

// 3. Main Analysis Logic
async function analyzeVideo(videoPath, heightM = 1.80) {
  console.log(`[Processing] Initializing TensorFlow WASM...`);
  
  await tf.setBackend("wasm");
  await tf.ready();

  console.log(`[Processing] Loading Model...`);
  const model = poseDetection.SupportedModels.MoveNet;
  const detector = await poseDetection.createDetector(model, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
  });

  // FIXED: Use crypto.randomUUID() instead of uuidv4()
  const framesDir = `frames/${crypto.randomUUID()}`;
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

  console.log(`[Processing] Extracting frames...`);
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .fps(30)
      .size("256x256")
      .save(`${framesDir}/frame_%04d.jpg`)
      .on("end", resolve)
      .on("error", reject);
  });

  const files = fs.readdirSync(framesDir).sort();
  console.log(`[Processing] Analyzing ${files.length} frames...`);

  // Initialize Filters
  const filters = Array(17).fill(0).map(() => ({ x: new OneEuroFilter(1.0, 0.05), y: new OneEuroFilter(1.0, 0.05) }));
  
  let timeline = [];
  const PIXELS_PER_METER = 250; 
  let frameTime = 0;
  const DT = 1/30;

  for (const file of files) {
    const buffer = fs.readFileSync(path.join(framesDir, file));
    
    // Decode and ensure 3 channels (RGB)
    const { data, info } = await sharp(buffer)
      .removeAlpha() 
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tfimage = tf.tensor3d(
      new Uint8Array(data), 
      [info.height, info.width, 3], 
      "int32"
    );

    const poses = await detector.estimatePoses(tfimage);
    tfimage.dispose();

    if (poses.length > 0) {
      let kps = poses[0].keypoints;

      // Apply Smoothing
      kps = kps.map((p, i) => ({
        x: filters[i].x.filter(p.x, frameTime),
        y: filters[i].y.filter(p.y, frameTime),
        name: p.name
      }));

      timeline.push({ t: frameTime, kps });
    }
    frameTime += DT;
  }

  // Cleanup Frames
  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
  } catch(e) { console.log("Cleanup error (ignoring):", e.message); }

  return runYabuLogic(timeline, PIXELS_PER_METER);
}

function runYabuLogic(timeline, pxPerMeter) {
  let peakWristSpeed = 0;
  let releaseIdx = 0;

  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i-1].kps;
    const curr = timeline[i].kps;
    const wristIdx = 10; 
    const d = dist(curr[wristIdx], prev[wristIdx]);
    const speed = d / (1/30); 

    if (speed > peakWristSpeed) {
      peakWristSpeed = speed;
      releaseIdx = i;
    }
  }

  if (peakWristSpeed < 50) return { error: "No throw detected. Try throwing faster/closer." };

  const releaseData = timeline[releaseIdx];
  const kps = releaseData.kps;

  const wristSpeedMph = (peakWristSpeed / pxPerMeter) * 2.237 * 1.5; 

  const shL = kps[5], shR = kps[6];
  const hipL = kps[11], hipR = kps[12];
  
  const shAngle = Math.atan2(shR.y - shL.y, shR.x - shL.x);
  const hipAngle = Math.atan2(hipR.y - hipL.y, hipR.x - hipL.x);
  let separation = Math.abs((shAngle - hipAngle) * (180/Math.PI));
  if (separation > 180) separation = 360 - separation;

  const elbowAngle = angleBetween(kps[6], kps[8], kps[10]); 
  const releaseTime = (releaseIdx * (1/30)).toFixed(2);

  let score = 100;
  let feedbackItems = [];

  // 1. SEPARATION CHECK
  if (separation < 20) {
    score -= 15;
    feedbackItems.push({
      issue: "Low Hip-Shoulder Separation",
      risk: "Increased strain on the shoulder labrum due to lack of kinetic chain energy transfer.",
      fix: "Focus on keeping your hips open towards the target while keeping your shoulder closed / back longer. Think 'hips go, then shoulders'."
    });
  }

  // 2. ELBOW ANGLE CHECK
  if (elbowAngle < 70) {
    score -= 10;
    feedbackItems.push({
      issue: "Elbow Collapsing / Too Tight",
      risk: "High valgus stress on the elbow (UCL injury risk).",
      fix: "Keep your elbow up and away from your head. Maintain a 'L' shape or wider angle at cocking phase."
    });
  } else if (elbowAngle > 140) {
    score -= 10;
    feedbackItems.push({
      issue: "Arm Casting / Too Straight",
      risk: "Shoulder impingement and bicep tendonitis.",
      fix: "Don't lock your arm out. Keep a slight bend to allow for a whip-like action."
    });
  }

  // 3. VELOCITY / LEG DRIVE CHECK
  if (wristSpeedMph < 35) {
    feedbackItems.push({
      issue: "Low Velocity / Poor Leg Drive",
      risk: "Over-reliance on arm strength can lead to overuse injuries.",
      fix: "Push harder off your back leg. Power comes from the ground up."
    });
  }

  // Default "Good Job" if nothing wrong
  if (feedbackItems.length === 0) {
    feedbackItems.push({
      issue: "None Detected",
      risk: "Low injury risk based on this analysis.",
      fix: "Great form! Focus on consistency and spot-target accuracy."
    });
  }

  return {
    form_score: Math.max(0, Math.round(score)),
    pred_vel_mph: wristSpeedMph.toFixed(1),
    sep_at_release: Math.round(separation),
    elbow_at_release: Math.round(elbowAngle),
    release_time: releaseTime,
    feedback_items: feedbackItems // New structured format
  };
}

app.post("/analyze", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, msg: "No video" });
  
  try {
    const report = await analyzeVideo(req.file.path);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, data: report });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, msg: "Analysis failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BioTracker Analyst Server running on ${PORT}`);
});