import { HandTracker } from './handTracking';
import { GestureDetector } from './gestureDetector';
import { HandVisualizer } from './handVisualizer';
import { HandLandmarks, GestureState, Point2D, Stroke } from './types';
import { STROKE } from './constants';

interface CircleScore {
  circularity: number;
  isCircle: boolean;
  feedback: string;
  shapeName: string;
}

class CircleGame {
  // Core components
  private handTracker: HandTracker;
  private gestureDetector: GestureDetector;
  private handVisualizer: HandVisualizer;

  // Game state
  private isPlaying = false;
  private currentColor = '#FFD700';

  // Drawing elements
  private drawingPoints: Point2D[] = [];
  private isDrawing = false;
  private lastAccuracy = 0;

  // DOM elements
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videoElement: HTMLVideoElement;
  private loadingOverlay: HTMLElement;
  private accuracyDisplay: HTMLElement;
  private feedbackDisplay: HTMLElement;

  // Hand tracking
  private currentLandmarks: HandLandmarks | null = null;
  private lastGestureState: GestureState | null = null;

  // Animation
  private lastFrameTime = 0;

  // Circle detection parameters
  private minPointsForCircle = 15;

  constructor() {
    // Get DOM elements
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;

    this.videoElement = document.getElementById('webcam') as HTMLVideoElement;
    this.loadingOverlay = document.getElementById('loading-overlay')!;
    this.accuracyDisplay = document.getElementById('accuracy-display')!;
    this.feedbackDisplay = document.getElementById('feedback-display')!;

    // Initialize components
    this.handTracker = new HandTracker(this.videoElement);
    this.gestureDetector = new GestureDetector();
    this.handVisualizer = new HandVisualizer(document.getElementById('hand-canvas') as HTMLCanvasElement);

    // Set initial size
    this.resize();

    // Setup event listeners
    this.setupEventListeners();
    this.setupButtonListeners();

    // Start the game
    this.init();
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.resize());
  }

  private setupButtonListeners(): void {
    // Start button
    const startBtn = document.getElementById('start-btn');
    startBtn?.addEventListener('click', () => {
      this.startGame();
    });

    // Clear button
    const clearBtn = document.getElementById('clear-btn');
    clearBtn?.addEventListener('click', () => {
      this.clearCanvas();
    });

    // Menu button
    const menuBtn = document.getElementById('menu-btn');
    menuBtn?.addEventListener('click', () => {
      this.goToMenu();
    });
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.canvas.width = width;
    this.canvas.height = height;
    this.handVisualizer.resize(width, height);
    this.handTracker.setCanvasSize(width, height);
  }

  private async init(): Promise<void> {
    try {
      // Start hand tracking
      await this.handTracker.start((landmarks) => this.onHandResults(landmarks));

      // Setup camera preview
      this.setupCameraPreview();

      // Hide loading overlay
      this.loadingOverlay.classList.add('hidden');

      // Start animation loop
      this.animate();

      // Show menu initially
      this.showMenu();
    } catch (error) {
      console.error('Failed to initialize:', error);
      this.showFeedback('Camera access denied. Please allow camera access and refresh.');
    }
  }

  private setupCameraPreview(): void {
    const webcam = document.getElementById('webcam') as HTMLVideoElement;
    const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;
    
    if (webcam.srcObject) {
      previewVideo.srcObject = webcam.srcObject;
      previewVideo.play().catch(err => {
        console.warn('Could not play preview video:', err);
      });
    }
    
    webcam.onloadedmetadata = () => {
      if (webcam.srcObject && !previewVideo.srcObject) {
        previewVideo.srcObject = webcam.srcObject;
        previewVideo.play().catch(err => {
          console.warn('Could not play preview video:', err);
        });
      }
    };
  }

  private onHandResults(landmarks: HandLandmarks | null): void {
    this.currentLandmarks = landmarks;

    if (!landmarks) {
      if (this.isDrawing) {
        this.finishDrawing();
      }
      return;
    }

    // Detect gesture
    const gestureState = this.gestureDetector.detect(landmarks);
    this.handleGesture(gestureState, landmarks);
    this.lastGestureState = gestureState;
  }

  private handleGesture(state: GestureState, landmarks: HandLandmarks): void {
    const indexTip = this.gestureDetector.getIndexTip(landmarks);
    const isDrawingGesture = state.current === 'draw';
    const wasDrawingGesture = this.lastGestureState?.current === 'draw';

    if (isDrawingGesture) {
      if (!wasDrawingGesture) {
        this.startDrawing(indexTip);
      } else if (this.isDrawing) {
        this.continueDrawing(indexTip);
      }
    } else if (!isDrawingGesture && this.isDrawing) {
      this.finishDrawing();
    }
  }

  private startDrawing(position: Point2D): void {
    if (!this.isPlaying) return;

    this.isDrawing = true;
    this.drawingPoints = [position];
  }

  private continueDrawing(position: Point2D): void {
    if (!this.isDrawing) return;

    const lastPoint = this.drawingPoints[this.drawingPoints.length - 1];
    const dist = Math.sqrt(
      Math.pow(position.x - lastPoint.x, 2) +
      Math.pow(position.y - lastPoint.y, 2)
    );

    if (dist >= STROKE.MIN_POINT_DISTANCE) {
      this.drawingPoints.push(position);
    }
  }

  private finishDrawing(): void {
    if (!this.isDrawing) return;

    this.isDrawing = false;

    // Debug: log points count
    console.log('Drawing finished. Points:', this.drawingPoints.length);

    // Analyze the drawn shape
    if (this.drawingPoints.length >= this.minPointsForCircle) {
      const result = this.calculateCircularity(this.drawingPoints);
      
      // Debug: log analysis results
      console.log('Result:', result);
      
      this.lastAccuracy = result.circularity;
      this.updateAccuracyDisplay(result.circularity);
      
      // Show feedback for ALL shapes, not just circles
      console.log('Showing feedback:', result.feedback);
      this.showFeedback(result.feedback, 3000);
    } else {
      console.log('Not enough points. Need:', this.minPointsForCircle, 'Got:', this.drawingPoints.length);
      this.showFeedback('Draw a bigger shape!', 1500);
    }
  }

  private calculateCircularity(points: Point2D[]): CircleScore {
    if (points.length < 2) {
      return { circularity: 0, isCircle: false, feedback: 'Draw a bigger circle!', shapeName: 'Unknown' };
    }

    // Calculate centroid
    let sumX = 0, sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }
    const centerX = sumX / points.length;
    const centerY = sumY / points.length;

    // Calculate average radius
    let sumRadius = 0;
    const radii: number[] = [];
    for (const p of points) {
      const r = Math.sqrt(
        Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2)
      );
      radii.push(r);
      sumRadius += r;
    }
    const avgRadius = sumRadius / points.length;

    // Calculate radius variance (how consistent the distance from center is)
    let variance = 0;
    for (const r of radii) {
      variance += Math.pow(r - avgRadius, 2);
    }
    variance /= points.length;
    const stdDev = Math.sqrt(variance);
    const radiusConsistency = avgRadius > 0 ? Math.max(0, 1 - (stdDev / avgRadius)) : 0;
    const radiusPercent = Math.round(radiusConsistency * 100);

    // Calculate angular distribution (key for distinguishing circles from squares/triangles)
    const numSectors = 12; // Divide circle into 12 sectors (30 degrees each)
    const sectorCounts = new Array(numSectors).fill(0);
    
    for (const p of points) {
      // Calculate angle in radians (-π to π)
      const angle = Math.atan2(p.y - centerY, p.x - centerX);
      // Convert to 0 to 2π
      const normalizedAngle = angle < 0 ? angle + Math.PI * 2 : angle;
      // Find which sector
      const sectorIndex = Math.floor((normalizedAngle / (Math.PI * 2)) * numSectors) % numSectors;
      sectorCounts[sectorIndex]++;
    }

    // Count how many sectors have significant points (at least 5% of total points)
    const threshold = points.length * 0.05;
    let sectorsWithPoints = 0;
    for (const count of sectorCounts) {
      if (count >= threshold) {
        sectorsWithPoints++;
      }
    }

    // For a perfect circle, all/nearly all sectors should have points
    // For a square, only ~4 sectors have points (the corners)
    // For a triangle, only ~3 sectors have points
    const angularScore = Math.round((sectorsWithPoints / numSectors) * 100);

    // Check if start and end points are close (closed shape)
    const startPoint = points[0];
    const endPoint = points[points.length - 1];
    const distanceStartEnd = Math.sqrt(
      Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2)
    );
    const closureThreshold = avgRadius * 0.4;
    const isClosed = distanceStartEnd < closureThreshold;
    const closurePercent = avgRadius > 0 ? Math.max(0, 100 - (distanceStartEnd / avgRadius) * 100) : 0;

    // Combined score: needs both good angular distribution AND radius consistency AND closure
    // Weight angular distribution more heavily (it's the key differentiator)
    const combinedScore = Math.round((angularScore * 0.5) + (radiusPercent * 0.3) + (closurePercent * 0.2));

    // Determine if it's a circle
    const isCircle = angularScore >= 75 && radiusPercent >= 50 && isClosed;

    // Analyze what shape it is
    let shapeName = 'Unknown';
    if (isCircle) {
      shapeName = 'Circle';
    } else if (sectorsWithPoints <= 4 && radiusPercent >= 40) {
      shapeName = 'Square';
    } else if (sectorsWithPoints <= 3 && radiusPercent >= 35) {
      shapeName = 'Triangle';
    } else if (angularScore >= 60 && radiusPercent < 45) {
      shapeName = 'Oval/Ellipse';
    } else if (angularScore >= 50 && radiusPercent < 40) {
      shapeName = 'Rectangle';
    } else if (angularScore < 40) {
      shapeName = 'Polygon';
    } else {
      shapeName = 'Irregular Shape';
    }

    // Feedback based on combined analysis
    let feedback = '';
    if (!isClosed) {
      feedback = 'Close your shape to make a circle!';
    } else if (!isCircle) {
      feedback = `Not a circle! This looks more like a ${shapeName}`;
    } else if (combinedScore >= 90 && isCircle) {
      feedback = '🎯 PERFECT CIRCLE!';
    } else if (combinedScore >= 80 && isCircle) {
      feedback = '⭐ Excellent!';
    } else if (combinedScore >= 70 && isCircle) {
      feedback = '✓ Good Circle';
    } else if (combinedScore >= 60 && isCircle) {
      feedback = 'Not bad!';
    } else if (combinedScore >= 50) {
      feedback = 'Try to make it more circular';
    } else {
      feedback = 'Keep practicing!';
    }

    return {
      circularity: combinedScore,
      isCircle,
      feedback,
      shapeName
    };
  }

  private updateAccuracyDisplay(accuracy: number): void {
    this.accuracyDisplay.textContent = `${accuracy}%`;
    
    // Color based on accuracy
    if (accuracy >= 80) {
      this.accuracyDisplay.style.color = '#4ade80'; // Green
    } else if (accuracy >= 60) {
      this.accuracyDisplay.style.color = '#FFD700'; // Gold
    } else if (accuracy >= 40) {
      this.accuracyDisplay.style.color = '#fbbf24'; // Yellow
    } else {
      this.accuracyDisplay.style.color = '#f87171'; // Red
    }
  }

  private clearCanvas(): void {
    this.drawingPoints = [];
    this.lastAccuracy = 0;
    this.updateAccuracyDisplay(0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private startGame(): void {
    this.isPlaying = true;
    this.clearCanvas();
    this.hideMenu();
    this.hideFeedback();
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const deltaTime = this.lastFrameTime > 0 ? (now - this.lastFrameTime) / 1000 : 0.016;
    this.lastFrameTime = now;

    // Render game canvas
    this.render();

    // Render hand visualization
    const gestureState = this.lastGestureState || {
      current: 'none' as const,
      previous: 'none' as const,
      duration: 0,
      velocity: { x: 0, y: 0 },
      confidence: 0
    };
    this.handVisualizer.render(
      this.currentLandmarks,
      gestureState,
      this.currentColor,
      deltaTime
    );
  }

  private render(): void {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Calculate real-time accuracy if drawing
    let strokeColor = this.currentColor;
    let currentAccuracy = 0;
    
    if (this.drawingPoints.length >= this.minPointsForCircle) {
      const result = this.calculateCircularity(this.drawingPoints);
      currentAccuracy = result.circularity;
      
      // Color based on real-time accuracy
      if (currentAccuracy >= 80) {
        strokeColor = '#4ade80'; // Green - Great circle
      } else if (currentAccuracy >= 60) {
        strokeColor = '#FFD700'; // Gold - Good circle
      } else if (currentAccuracy >= 40) {
        strokeColor = '#fbbf24'; // Yellow - Needs improvement
      } else {
        strokeColor = '#f87171'; // Red - Not circular
      }
      
      // Update accuracy display in real-time
      this.updateAccuracyDisplay(currentAccuracy);
    }

    // Draw user's stroke with dynamic color
    if (this.drawingPoints.length > 0) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.drawingPoints[0].x, this.drawingPoints[0].y);

      for (let i = 1; i < this.drawingPoints.length; i++) {
        const p0 = this.drawingPoints[i - 1];
        const p1 = this.drawingPoints[i];

        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        this.ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }

      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = STROKE.WIDTH;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();

      // Draw live point with dynamic color
      if (this.drawingPoints.length > 0) {
        const lastPoint = this.drawingPoints[this.drawingPoints.length - 1];
        this.ctx.beginPath();
        this.ctx.arc(lastPoint.x, lastPoint.y, STROKE.WIDTH / 2, 0, Math.PI * 2);
        this.ctx.fillStyle = strokeColor;
        this.ctx.fill();
      }
    }
  }

  private showFeedback(message: string, duration?: number): void {
    this.feedbackDisplay.textContent = message;
    this.feedbackDisplay.classList.add('visible');

    if (duration) {
      setTimeout(() => this.hideFeedback(), duration);
    }
  }

  private hideFeedback(): void {
    this.feedbackDisplay.classList.remove('visible');
  }

  private showMenu(): void {
    const menu = document.getElementById('game-menu');
    if (menu) menu.classList.remove('hidden');
  }

  private hideMenu(): void {
    const menu = document.getElementById('game-menu');
    if (menu) menu.classList.add('hidden');
  }

  private goToMenu(): void {
    this.isPlaying = false;
    this.clearCanvas();
    this.showMenu();
  }
}

// Start the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new CircleGame();
});
