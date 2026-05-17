import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as geofire from 'geofire-common';

admin.initializeApp();
const db = admin.firestore();

export const onSOSTriggered = functions.firestore
  .document('sos_events/{eventId}')
  .onCreate(async (snap, context) => {
    const eventId = context.params.eventId;
    const eventData = snap.data();
    
    if (!eventData || !eventData.location) {
        console.error('Event data or location missing');
        return;
    }

    const { latitude, longitude } = eventData.location;
    const center = [latitude, longitude];
    const radiusInM = 1000; // 1km radius

    // Each item in 'bounds' represents a startCode/endCode pair. We keep only one pair here
    // for simplicity, but a production app should query all pairs in 'bounds'.
    const bounds = geofire.geohashQueryBounds(center as [number, number], radiusInM);
    const promises = [];
    for (const b of bounds) {
      const q = db.collection('users')
        .where('isActiveGuardian', '==', true)
        .orderBy('geohash')
        .startAt(b[0])
        .endAt(b[1]);
      promises.push(q.get());
    }

    const snapshots = await Promise.all(promises);
    const nearbyGuardians: any[] = [];

    for (const snap of snapshots) {
      for (const doc of snap.docs) {
        const lat = doc.get('lat');
        const lng = doc.get('lng');

        // We have to filter the false positives due to GeoHash accuracy
        const distanceInKm = geofire.distanceBetween([lat, lng], center as [number, number]);
        const distanceInM = distanceInKm * 1000;
        if (distanceInM <= radiusInM) {
          nearbyGuardians.push({ id: doc.id, ...doc.data(), distanceMeters: distanceInM });
        }
      }
    }
      
    const batch = db.batch();
    const tokens: string[] = [];

    nearbyGuardians.forEach(guardian => {
      const alertRef = db.collection('guardian_alerts').doc();
      batch.set(alertRef, {
        eventId: eventId,
        guardianId: guardian.id,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
        distanceMeters: Math.round(guardian.distanceMeters),
        victimLocation: { latitude, longitude }
      });
      if (guardian.fcmTokens) {
        tokens.push(...guardian.fcmTokens);
      }
    });

    await batch.commit();

    if (tokens.length > 0) {
      const payload = {
        notification: {
          title: '🛡 SHIELD ALERT: NEARBY EMERGENCY',
          body: `Someone needs help within ${radiusInM}m of your location.`,
          sound: 'emergency_alert.wav'
        },
        data: {
          type: 'GUARDIAN_ALERT',
          eventId: eventId,
          lat: latitude.toString(),
          lng: longitude.toString(),
          navLink: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
          deepLink: `shield://guardian-rescue/${eventId}`
        }
      };
      // Note: Use sendEachForMulticast in newer SDKs, but keep compatibility
      await admin.messaging().sendToDevice(tokens, payload);
    }
  });

export const onGuardianAlertUpdate = functions.firestore
  .document('guardian_alerts/{alertId}')
  .onUpdate(async (change, context) => {
    const newData = change.after.data();
    if (newData.status === 'navigating') {
      // Notify victim
      const eventDoc = await db.collection('sos_events').doc(newData.eventId).get();
      const event = eventDoc.data();
      if (event) {
        const victimDoc = await db.collection('users').doc(event.userId).get();
        const victimTokens = victimDoc.data()?.fcmTokens || [];
        if (victimTokens.length > 0) {
          await admin.messaging().sendToDevice(victimTokens, {
            notification: {
              title: 'Guardian Responding',
              body: 'A guardian is on their way to your location.'
            }
          });
        }
      }
    }
  });

export const generateEvidenceLink = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  
  const { eventId, sessionIds } = data;
  const token = admin.firestore().collection('evidence_vault').doc().id;
  
  const recordings = (sessionIds || []).map((id: string) => `sos_recordings/${eventId}/${id}.webm`);
  
  await db.collection('evidence_vault').doc(token).set({
    userId: context.auth.uid,
    eventId: eventId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    recordings: recordings,
    accessToken: token,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
    viewCount: 0,
    allowedViewers: []
  });
  
  // In a real app, send this link to trusted contacts via FCM or SMS
  // For now, we return it to the client
  return { url: `https://shield.app/evidence/${token}` };
});

export const onEvidenceAccess = functions.https.onRequest(async (req, res) => {
  const { token } = req.query;
  if (!token) {
    res.status(400).send('Missing token');
    return;
  }
  
  const doc = await db.collection('evidence_vault').doc(token as string).get();
  if (!doc.exists) {
    res.status(404).send('Invalid or expired link');
    return;
  }
  
  const data = doc.data();
  if (data && data.expiresAt.toDate() < new Date()) {
      res.status(403).send('Link expired');
      return;
  }
  
  await doc.ref.update({ viewCount: admin.firestore.FieldValue.increment(1) });
  res.status(200).json(data);
});

export const cleanupExpiredEvents = functions.pubsub.schedule('every 1 hours').onRun(async (context) => {
  const expiredTime = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const snapshot = await db.collection('sos_events')
    .where('status', '==', 'resolved')
    .where('triggeredAt', '<', expiredTime)
    .get();
    
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { status: 'archived' });
  });
  await batch.commit();
});
