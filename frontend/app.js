// SHIELD OS - Black & Gold Edition
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "shield-os-dev",
    storageBucket: "shield-os-dev.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

document.addEventListener('DOMContentLoaded', () => {
    const sosBtn = document.getElementById('sos-btn');
    const statusLog = document.getElementById('status-log');
    const guardiansList = document.getElementById('guardians-list');
    const genLinkBtn = document.getElementById('gen-link-btn');
    const locationValue = document.getElementById('current-location');
    const hiddenVideo = document.getElementById('hidden-video');
    const previewVideo = document.getElementById('preview-video');
    const cameraPreview = document.getElementById('camera-preview');
    const timerDisplay = document.getElementById('timer-display');
    const recordingInfo = document.getElementById('recording-info');
    const uploadStatus = document.getElementById('upload-status');

    let map, userMarker, sosRadius;
    let guardianMarkers = {};
    let sosActive = false;
    let currentEventId = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let segmentCount = 0;
    let currentLocation = [40.7128, -74.0060];
    let startTime, timerInterval;

    // --- Leaflet Implementation ---
    const initMap = () => {
        map = L.map('map', { zoomControl: false, attributionControl: false }).setView(currentLocation, 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

        const userIcon = L.divIcon({
            className: 'user-marker',
            html: '<div class="pulse-marker"></div>',
            iconSize: [20, 20]
        });
        userMarker = L.marker(currentLocation, { icon: userIcon }).addTo(map);
    };

    const addLog = (msg, type = 'system') => {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        entry.innerHTML = `<span style="color: #a0a0a0">[${time}]</span> ${msg}`;
        statusLog.prepend(entry);
    };

    const startTimer = () => {
        startTime = Date.now();
        timerDisplay.style.display = 'block';
        timerInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const h = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
            const m = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
            timerDisplay.textContent = `${h}:${m}:${s}`;
        }, 1000);
    };

    const trackLocation = () => {
        if ("geolocation" in navigator) {
            navigator.geolocation.watchPosition((pos) => {
                currentLocation = [pos.coords.latitude, pos.coords.longitude];
                locationValue.textContent = `N ${currentLocation[0].toFixed(4)}° W ${currentLocation[1].toFixed(4)}°`;
                if (userMarker) userMarker.setLatLng(currentLocation);
            }, null, { enableHighAccuracy: true });
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            hiddenVideo.srcObject = stream;
            previewVideo.srcObject = stream;
            
            // Show camera preview temporarily (10 seconds)
            cameraPreview.style.display = 'block';
            setTimeout(() => { cameraPreview.style.display = 'none'; }, 10000);
            
            recordingInfo.style.display = 'flex';
            addLog("VIDEO RECORDING: INITIALIZED", "success");

            const rotateRecording = () => {
                recordedChunks = [];
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
                mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
                mediaRecorder.onstop = () => {
                    const blob = new Blob(recordedChunks, { type: 'video/webm' });
                    uploadSegment(blob, segmentCount++);
                };
                mediaRecorder.start();
                setTimeout(() => { if (sosActive) { mediaRecorder.stop(); rotateRecording(); } }, 30000);
            };
            rotateRecording();
        } catch (err) {
            addLog("CAMERA ACCESS DENIED", "alert");
        }
    };

    const uploadSegment = async (blob, index) => {
        if (!currentEventId) return;
        
        const progressContainer = document.getElementById('progress-container');
        const progressBar = document.getElementById('progress-bar');
        
        progressContainer.style.display = 'block';
        uploadStatus.style.display = 'block';
        uploadStatus.textContent = `DRIVE UPLOADING: SEGMENT ${index} SYNCING...`;
        
        // Simulate progress bar animation
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            progressBar.style.width = `${progress}%`;
            if (progress >= 100) clearInterval(interval);
        }, 100);

        const ref = storage.ref().child(`sos_recordings/${currentEventId}/segment_${index}.webm`);
        try {
            await ref.put(blob);
            addLog(`DRIVE UPLOADING: SEGMENT ${index} COMPLETE`, 'success');
            uploadStatus.textContent = `DRIVE UPLOADING: SEGMENT ${index} SUCCESS`;
            setTimeout(() => { progressBar.style.width = '0%'; }, 1000);
        } catch (err) {
            addLog(`DRIVE UPLOADING: SEGMENT ${index} FAILED - RETRYING`, 'alert');
            setTimeout(() => uploadSegment(blob, index), 3000);
        }
    };

    const initiateSOSProtocol = async () => {
        if (sosActive) return;
        sosActive = true;

        sosBtn.style.boxShadow = '0 0 60px var(--accent-gold), inset 0 0 30px rgba(0,0,0,0.5)';
        sosBtn.innerHTML = '<span class="sos-text">ACTIVE</span>';
        
        // Add 850m Radius
        sosRadius = L.circle(currentLocation, {
            color: '#c5a021',
            fillColor: '#c5a021',
            fillOpacity: 0.1,
            radius: 850
        }).addTo(map);
        map.fitBounds(sosRadius.getBounds());

        addLog('SOS PROTOCOL INITIATED', 'alert');
        addLog('NOTIFICATION DISPATCHED TO NEARBY GUARDIANS', 'success');
        
        // Activate UI dots
        document.getElementById('rec-status').classList.add('recording');
        document.getElementById('cloud-status').classList.add('active');
        document.getElementById('alert-status').classList.add('active');

        startTimer();
        await startRecording();

        // Simulate 4 Guardians immediately
        const mockGuardianIds = ['G-772', 'G-109', 'G-443', 'G-881'];
        mockGuardianIds.forEach((id, i) => {
            setTimeout(() => {
                addGuardianMarker(id);
                addLog(`GUARDIAN ${id} DETECTED WITHIN 850m RADIUS`, 'success');
            }, i * 1500);
        });

        genLinkBtn.disabled = false;
    };

    const addGuardianMarker = (id) => {
        // Position within 850m radius (approx 0.007 degrees)
        const gPos = [
            currentLocation[0] + (Math.random() - 0.5) * 0.01,
            currentLocation[1] + (Math.random() - 0.5) * 0.01
        ];

        const guardianIcon = L.divIcon({
            className: 'guardian-marker',
            html: '<div class="g-marker"></div>',
            iconSize: [15, 15]
        });

        const marker = L.marker(gPos, { icon: guardianIcon }).addTo(map);
        guardianMarkers[id] = marker;
        
        const card = document.createElement('div');
        card.className = 'guardian-card';
        card.style.borderColor = 'var(--accent-gold)';
        card.innerHTML = `
            <div class="guardian-info">
                <h4>GUARDIAN ${id}</h4>
                <p>PROXIMITY: < 850m</p>
            </div>
            <span class="badge" style="background: var(--accent-gold)">NAVIGATING</span>
        `;
        guardiansList.prepend(card);
    };

    // Interaction
    sosBtn.addEventListener('mouseup', initiateSOSProtocol);

    // Init
    initMap();
    trackLocation();
});
