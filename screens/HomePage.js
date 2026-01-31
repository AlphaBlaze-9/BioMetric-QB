import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Dimensions,
} from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Video } from "expo-av"; // To replay the throw
import * as FileSystem from 'expo-file-system';

// --- CONFIG ---
// REPLACE WITH YOUR PC'S LOCAL IP
const SERVER_URL = "http://10.0.0.8:8080/analyze";

export default function HomePage() {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const cameraRef = useRef(null);
  const [facing, setFacing] = useState("back");

  // State Machine: 'idle', 'recording', 'processing', 'results'
  const [mode, setMode] = useState("idle");
  const [videoUri, setVideoUri] = useState(null);
  const [report, setReport] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!camPerm?.granted) requestCamPerm();
    if (!micPerm?.granted) requestMicPerm();
  }, [camPerm, micPerm]);

  const startRecording = async () => {
    if (cameraRef.current) {
      try {
        setMode("recording");
        setRecordingTime(10);

        // Start Timer
        timerRef.current = setInterval(() => {
          setRecordingTime((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);

        // Record for up to 10 seconds or until stop
        const video = await cameraRef.current.recordAsync({
          maxDuration: 10,
          quality: "720p",
        });

        clearInterval(timerRef.current);
        setVideoUri(video.uri);
        uploadAndAnalyze(video.uri);
      } catch (e) {
        console.error(e);
        clearInterval(timerRef.current);
        setMode("idle");
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current) {
      cameraRef.current.stopRecording();
      clearInterval(timerRef.current);
    }
  };

  const uploadAndAnalyze = async (uri) => {
    setMode("processing");

    try {
      const formData = new FormData();
      formData.append("video", {
        uri: uri,
        type: "video/mp4",
        name: "throw.mp4",
      });

      // Calibrate height (optional, can be input by user)
      formData.append("height", "1.80");

      const response = await fetch(SERVER_URL, {
        method: "POST",
        body: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const result = await response.json();
      if (result.ok) {
        setReport(result.data);
        setMode("results");
      } else {
        Alert.alert("Error", "Analysis failed");
        setMode("idle");
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Network Error", "Could not reach server.");
      setMode("idle");
    }
  };

  const reset = () => {
    setReport(null);
    setVideoUri(null);
    setMode("idle");
  };

  if (!camPerm?.granted || !micPerm?.granted) {
    return <View style={styles.center}><Text>Permissions Needed</Text></View>;
  }

  return (
    <View style={styles.container}>
      {/* 1. CAMERA / VIDEO PREVIEW AREA */}
      <View style={styles.cameraContainer}>
        {mode === "results" || mode === "processing" ? (
          <Video
            source={{ uri: videoUri }}
            style={StyleSheet.absoluteFill}
            useNativeControls
            resizeMode="contain"
            isLooping
            shouldPlay
          />
        ) : (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mode="video"
          />
        )}

        {/* RECORDING TIMER OVERLAY */}
        {mode === "recording" && (
          <View style={styles.timerOverlay}>
            <View style={styles.recordingDot} />
            <Text style={styles.timerText}>00:{recordingTime < 10 ? `0${recordingTime}` : recordingTime}</Text>
          </View>
        )}

        {/* PROCESSING OVERLAY */}
        {mode === "processing" && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#00FFCC" />
            <Text style={styles.loadingText}>Analyzing Biomechanics...</Text>
            <Text style={styles.subText}>Checking Kinetic Chain & Injury Risks</Text>
          </View>
        )}
      </View>

      {/* 2. RESULTS PANEL (Replaces Controls when done) */}
      {mode === "results" && report ? (
        <ScrollView style={styles.resultsPanel}>
          <View style={styles.scoreHeader}>
            <Text style={styles.scoreTitle}>FORM SCORE</Text>
            <Text style={[styles.scoreVal, { color: report.form_score > 80 ? '#0f0' : 'orange' }]}>
              {report.form_score}
            </Text>
          </View>

          <View style={styles.statGrid}>
            <View style={styles.statBox}>
              <Text style={styles.label}>VELOCITY</Text>
              <Text style={styles.value}>{report.pred_vel_mph} <Text style={styles.unit}>MPH</Text></Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.label}>SEPARATION</Text>
              <Text style={styles.value}>{report.sep_at_release}°</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.label}>REL TIME</Text>
              <Text style={styles.value}>{report.release_time}s</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.label}>ELBOW</Text>
              <Text style={styles.value}>{report.elbow_at_release}°</Text>
            </View>
          </View>

          <View style={styles.coachContainer}>
            <Text style={styles.sectionTitle}>BIOMECHANICAL FEEDBACK</Text>

            {report.feedback_items && report.feedback_items.map((item, i) => (
              <View key={i} style={styles.feedbackCard}>
                <View style={styles.feedbackHeader}>
                  <Text style={styles.feedbackIssue}>{item.issue}</Text>
                </View>

                <View style={styles.feedbackRow}>
                  <Text style={styles.feedbackLabel}>⚠️ RISK:</Text>
                  <Text style={styles.feedbackRisk}>{item.risk}</Text>
                </View>

                <View style={styles.feedbackRow}>
                  <Text style={styles.feedbackLabel}>✅ FIX:</Text>
                  <Text style={styles.feedbackFix}>{item.fix}</Text>
                </View>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.btnReset} onPress={reset}>
            <Text style={styles.btnTextBlack}>NEW THROW</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        /* 3. CONTROL PANEL */
        <View style={styles.controls}>
          {mode === "recording" ? (
            <TouchableOpacity style={styles.btnStop} onPress={stopRecording}>
              <View style={styles.stopIcon} />
            </TouchableOpacity>
          ) : mode === "idle" ? (
            <TouchableOpacity style={styles.btnRecord} onPress={startRecording}>
              <View style={styles.recIcon} />
            </TouchableOpacity>
          ) : null}

          {mode === "idle" && (
            <TouchableOpacity style={styles.btnFlip} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}>
              <Text style={styles.btnText}>FLIP</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111", paddingTop: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  cameraContainer: { flex: 1, borderRadius: 20, overflow: 'hidden', margin: 10, backgroundColor: '#222' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#00FFCC', fontSize: 18, fontWeight: 'bold', marginTop: 10 },
  subText: { color: '#888', fontSize: 14 },

  controls: { height: 120, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 30 },
  btnRecord: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  recIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'red' },
  btnStop: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  stopIcon: { width: 40, height: 40, borderRadius: 4, backgroundColor: 'red' },
  btnFlip: { position: 'absolute', right: 30, backgroundColor: '#333', padding: 10, borderRadius: 8 },
  btnText: { color: '#FFF', fontWeight: 'bold' },

  timerOverlay: { position: 'absolute', top: 20, right: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 20 },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'red', marginRight: 8 },
  timerText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },

  resultsPanel: { flex: 1, padding: 20 },
  scoreHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  scoreTitle: { color: '#FFF', fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  scoreVal: { fontSize: 48, fontWeight: 'bold' },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: { width: '48%', backgroundColor: '#222', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  label: { color: '#AAA', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  value: { color: '#FFF', fontSize: 24, fontWeight: 'bold' },
  unit: { fontSize: 14, color: '#666', fontWeight: 'normal' },

  coachContainer: { marginTop: 10 },
  sectionTitle: { color: '#00FFCC', fontSize: 14, fontWeight: 'bold', marginBottom: 10, letterSpacing: 1.2 },

  feedbackCard: { backgroundColor: '#1A1A1A', padding: 16, borderRadius: 12, marginBottom: 15, borderLeftWidth: 4, borderLeftColor: '#FF5555' },
  feedbackHeader: { marginBottom: 8 },
  feedbackIssue: { color: '#FF5555', fontSize: 18, fontWeight: 'bold' },

  feedbackRow: { marginTop: 8 },
  feedbackLabel: { color: '#888', fontSize: 12, fontWeight: 'bold', marginBottom: 2 },
  feedbackRisk: { color: '#CCC', fontSize: 14, fontStyle: 'italic' },
  feedbackFix: { color: '#FFF', fontSize: 15, fontWeight: '500' },

  btnReset: { backgroundColor: '#00FFCC', padding: 18, borderRadius: 12, alignItems: 'center', marginTop: 20, marginBottom: 50, shadowColor: '#00FFCC', shadowOpacity: 0.3, shadowRadius: 10 },
  btnTextBlack: { color: '#000', fontWeight: 'bold', fontSize: 16, letterSpacing: 0.5 }
});