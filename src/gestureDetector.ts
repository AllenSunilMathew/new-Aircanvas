import { HandLandmarks, GestureType, GestureState, Point2D } from './types';
import { LANDMARKS } from './constants';

export class GestureDetector {
  private lastLandmarks: HandLandmarks | null = null;
  private lastTime: number = 0;
  private gestureStartTime: number = 0;
  private currentGesture: GestureType = 'none';
  private previousGesture: GestureType = 'none';

  detect(landmarks: HandLandmarks | null): GestureState {
    const now = performance.now();
    const dt = this.lastTime > 0 ? (now - this.lastTime) / 1000 : 0;
    this.lastTime = now;

    if (!landmarks) {
      return this.createState('none', { x: 0, y: 0 }, 0);
    }

    const velocity = this.calculateVelocity(landmarks, dt);
    const detectedGesture = this.detectGestureType(landmarks);

    if (detectedGesture !== this.currentGesture) {
      this.previousGesture = this.currentGesture;
      this.currentGesture = detectedGesture;
      this.gestureStartTime = now;
    }

    const duration = now - this.gestureStartTime;
    this.lastLandmarks = landmarks;

    // Yahan pinchDistance bhi return kar rahe hain taake Main file use kar sake
    const pinchDistance = this.distance(
        landmarks.landmarks[LANDMARKS.THUMB_TIP],
        landmarks.landmarks[LANDMARKS.INDEX_TIP]
    );

    return {
      ...this.createState(this.currentGesture, velocity, duration),
      pinchDistance: pinchDistance // Extra data for zoom logic
    } as any;
  }

  private createState(gesture: GestureType, velocity: Point2D, duration: number): GestureState {
    return {
      current: gesture,
      previous: this.previousGesture,
      duration,
      velocity,
      confidence: 1.0
    };
  }

  private calculateVelocity(landmarks: HandLandmarks, dt: number): Point2D {
    if (!this.lastLandmarks || dt === 0) return { x: 0, y: 0 };
    const currentPalm = this.getPalmCenter(landmarks);
    const lastPalm = this.getPalmCenter(this.lastLandmarks);
    return {
      x: (currentPalm.x - lastPalm.x) / dt,
      y: (currentPalm.y - lastPalm.y) / dt
    };
  }

  public getPalmCenter(landmarks: HandLandmarks): Point2D {
    const wrist = landmarks.landmarks[LANDMARKS.WRIST];
    const indexMcp = landmarks.landmarks[LANDMARKS.INDEX_MCP];
    const pinkyMcp = landmarks.landmarks[LANDMARKS.PINKY_MCP];
    return {
      x: (wrist.x + indexMcp.x + pinkyMcp.x) / 3,
      y: (wrist.y + indexMcp.y + pinkyMcp.y) / 3
    };
  }

  private detectGestureType(landmarks: HandLandmarks): GestureType {
    const lm = landmarks.landmarks;

    // 1. PINCH CHECK (High Priority) - Threshold increased to 60 for easier grabbing
    const pinchDistance = this.distance(lm[LANDMARKS.THUMB_TIP], lm[LANDMARKS.INDEX_TIP]);

    if (pinchDistance < 60) { // <--- INCREASED THRESHOLD (Easier to pinch)
      return 'pinch';
    }

    // 2. FINGER COUNT CHECK (for zoom gestures)
    const extendedCount = this.countExtendedFingers(landmarks);
    if (extendedCount === 2) {
      return 'two';  // Zoom in
    } else if (extendedCount === 3) {
      return 'three';  // Zoom out
    }

    // 3. DRAW CHECK (Strict Index Finger)
    if (this.isPointingIndex(landmarks)) {
      return 'draw';
    }

    // 4. PALM / ROTATE CHECK
    if (this.isOpenPalm(landmarks)) {
      return 'palm';
    }

    // 6. FIST CHECK
    if (this.isFist(landmarks)) {
      return 'fist';
    }

    return 'none';
  }

  private distance(p1: Point2D, p2: Point2D): number {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  // --- Helper Checks ---

  private isFingerExtended(landmarks: HandLandmarks, tipIdx: number, pipIdx: number): boolean {
    const lm = landmarks.landmarks;
    // Simple check: Tip should be higher (lower Y) than Joint
    return lm[tipIdx].y < lm[pipIdx].y; 
  }

  private isPointingIndex(landmarks: HandLandmarks): boolean {
    // Index OPEN
    const indexOpen = this.isFingerExtended(landmarks, LANDMARKS.INDEX_TIP, LANDMARKS.INDEX_PIP);
    // Middle, Ring, Pinky CLOSED
    const middleClosed = !this.isFingerExtended(landmarks, LANDMARKS.MIDDLE_TIP, LANDMARKS.MIDDLE_PIP);
    const ringClosed = !this.isFingerExtended(landmarks, LANDMARKS.RING_TIP, LANDMARKS.RING_PIP);
    const pinkyClosed = !this.isFingerExtended(landmarks, LANDMARKS.PINKY_TIP, LANDMARKS.PINKY_PIP);
    
    return indexOpen && middleClosed && ringClosed && pinkyClosed;
  }

  private isOpenPalm(landmarks: HandLandmarks): boolean {
    // All fingers must be open
    return (
      this.isFingerExtended(landmarks, LANDMARKS.INDEX_TIP, LANDMARKS.INDEX_PIP) &&
      this.isFingerExtended(landmarks, LANDMARKS.MIDDLE_TIP, LANDMARKS.MIDDLE_PIP) &&
      this.isFingerExtended(landmarks, LANDMARKS.RING_TIP, LANDMARKS.RING_PIP) &&
      this.isFingerExtended(landmarks, LANDMARKS.PINKY_TIP, LANDMARKS.PINKY_PIP)
    );
  }

  private isFist(landmarks: HandLandmarks): boolean {
    // All fingers closed
    return (
      !this.isFingerExtended(landmarks, LANDMARKS.INDEX_TIP, LANDMARKS.INDEX_PIP) &&
      !this.isFingerExtended(landmarks, LANDMARKS.MIDDLE_TIP, LANDMARKS.MIDDLE_PIP) &&
      !this.isFingerExtended(landmarks, LANDMARKS.RING_TIP, LANDMARKS.RING_PIP) &&
      !this.isFingerExtended(landmarks, LANDMARKS.PINKY_TIP, LANDMARKS.PINKY_PIP)
    );
  }



  getIndexTip(landmarks: HandLandmarks): Point2D {
    return landmarks.landmarks[LANDMARKS.INDEX_TIP];
  }

  private countExtendedFingers(landmarks: HandLandmarks): number {
    let count = 0;

    // Check each finger (excluding thumb for simplicity)
    if (this.isFingerExtended(landmarks, LANDMARKS.INDEX_TIP, LANDMARKS.INDEX_PIP)) count++;
    if (this.isFingerExtended(landmarks, LANDMARKS.MIDDLE_TIP, LANDMARKS.MIDDLE_PIP)) count++;
    if (this.isFingerExtended(landmarks, LANDMARKS.RING_TIP, LANDMARKS.RING_PIP)) count++;
    if (this.isFingerExtended(landmarks, LANDMARKS.PINKY_TIP, LANDMARKS.PINKY_PIP)) count++;

    return count;
  }

  getPinchCenter(landmarks: HandLandmarks): Point2D {
    const thumb = landmarks.landmarks[LANDMARKS.THUMB_TIP];
    const index = landmarks.landmarks[LANDMARKS.INDEX_TIP];
    return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
  }


}
