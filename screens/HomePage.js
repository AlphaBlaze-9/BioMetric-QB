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

  useEffect(() => {
    if (!camPerm?.granted) requestCamPerm();
    if (!micPerm?.granted) requestMicPerm();
  }, [camPerm, micPerm]);

  const startRecording = async () => {
    if (cameraRef.current) {
      try {
        setMode("recording");
        // Record for up to 10 seconds or until stop
        const video = await cameraRef.current.recordAsync({
          maxDuration: 10,
          quality: "720p",
        });
        setVideoUri(video.uri);
        uploadAndAnalyze(video.uri);
      } catch (e) {
        console.error(e);
        setMode("idle");
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current) {
      cameraRef.current.stopRecording();
      // state change happens in recordAsync promise resolve
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

        {/* PROCESSING OVERLAY */}
        {mode === "processing" && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#00FFCC" />
            <Text style={styles.loadingText}>Analyzing Biomechanics...</Text>
            <Text style={styles.subText}>Breaking down frame by frame</Text>
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

          <View style={styles.coachBox}>
            <Text style={styles.coachTitle}>AI COACH FEEDBACK</Text>
            <Text style={styles.coachText}>"{report.feedback}"</Text>
            
            {report.penalties.map((p, i) => (
              <Text key={i} style={styles.penaltyText}>• {p}</Text>
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

  resultsPanel: { flex: 1, padding: 20 },
  scoreHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  scoreTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold' },
  scoreVal: { fontSize: 40, fontWeight: 'bold' },
  
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: { width: '48%', backgroundColor: '#222', padding: 15, borderRadius: 10, marginBottom: 10 },
  label: { color: '#888', fontSize: 12, fontWeight: 'bold' },
  value: { color: '#FFF', fontSize: 22, fontWeight: 'bold' },
  unit: { fontSize: 14, color: '#666' },

  coachBox: { marginTop: 10, padding: 15, backgroundColor: '#1A1A1A', borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#00FFCC' },
  coachTitle: { color: '#00FFCC', fontWeight: 'bold', marginBottom: 5 },
  coachText: { color: '#FFF', fontSize: 16, fontStyle: 'italic', marginBottom: 10 },
  penaltyText: { color: '#FF5555', fontSize: 14, marginBottom: 2 },

  btnReset: { backgroundColor: '#00FFCC', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 30, marginBottom: 50 },
  btnTextBlack: { color: '#000', fontWeight: 'bold', fontSize: 16 }
});