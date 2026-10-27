import { Point2D, Stroke, ShapeAnalysisResult } from './types';
import { analyzeShape, generatePerfectShape, straightenStroke } from './shapeUtils';

import { STROKE, GESTURE, WELDING } from './constants';

// Jitter filter threshold - ignore movements smaller than this
const JITTER_THRESHOLD = 3;

export class DrawingCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentStroke: Stroke | null = null;
  private completedStrokes: Stroke[] = [];
  private livePosition: Point2D | null = null;
  private filteredPosition: Point2D | null = null;  // Position after jitter filter
  private recentPoints: Point2D[] = [];  // Buffer for smoothing

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;

    // Enable image smoothing for better line quality
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    // Re-enable after resize
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  startStroke(point: Point2D, color: string): void {
    this.currentStroke = {
      points: [point],
      color,
      width: STROKE.WIDTH,
      closed: false
    };
    this.livePosition = point;
    this.filteredPosition = point;
    this.recentPoints = [point];
  }

  addPoint(point: Point2D): void {
    if (!this.currentStroke) return;

    // Apply jitter filter - ignore tiny movements
    const filtered = this.applyJitterFilter(point);

    // Add filtered point to buffer
    this.recentPoints.push(filtered);
    if (this.recentPoints.length > 10) {
      this.recentPoints.shift();
    }

    // Use strong smoothing
    const smoothed = this.getSmoothedPosition();
    this.livePosition = smoothed;

    const lastPoint = this.currentStroke.points[this.currentStroke.points.length - 1];
    const dist = this.distance(smoothed, lastPoint);

    // Only add points that are far enough apart
    if (dist >= STROKE.MIN_POINT_DISTANCE) {
      this.currentStroke.points.push(smoothed);
    }
  }

  // Filter out jitter - only update if movement is significant
  private applyJitterFilter(point: Point2D): Point2D {
    if (!this.filteredPosition) {
      this.filteredPosition = point;
      return point;
    }

    const dist = this.distance(point, this.filteredPosition);

    // If movement is below threshold, ignore it (return last position)
    if (dist < JITTER_THRESHOLD) {
      return this.filteredPosition;
    }

    // Movement is significant - update filtered position
    this.filteredPosition = point;
    return point;
  }

  // Strong smoothing using simple moving average
  private getSmoothedPosition(): Point2D {
    if (this.recentPoints.length === 0) {
      return { x: 0, y: 0 };
    }

    // Simple average of all points in buffer
    let sumX = 0, sumY = 0;
    for (const p of this.recentPoints) {
      sumX += p.x;
      sumY += p.y;
    }
    return {
      x: sumX / this.recentPoints.length,
      y: sumY / this.recentPoints.length
    };
  }

  // Update live position without adding a point (for real-time tracking)
  updateLivePosition(point: Point2D): void {
    const filtered = this.applyJitterFilter(point);
    this.recentPoints.push(filtered);
    if (this.recentPoints.length > 10) {
      this.recentPoints.shift();
    }
    this.livePosition = this.getSmoothedPosition();
  }

  clearLivePosition(): void {
    this.livePosition = null;
    this.filteredPosition = null;
    this.recentPoints = [];
  }

  private distance(p1: Point2D, p2: Point2D): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  pauseStroke(): void {
    // Stroke remains but we stop adding points
    // The stroke is kept for potential closing
  }

  closeStroke(): Stroke | null {
    if (!this.currentStroke) return null;

    // Check if stroke is long enough
    const length = this.calculateStrokeLength();
    if (length < GESTURE.MIN_STROKE_LENGTH) {
      this.discardStroke();
      return null;
    }

// Auto-straighten if high confidence (length already checked above)
    const straightened = straightenStroke(this.currentStroke!, 70); // 70% threshold
    straightened.closed = true;
    this.completedStrokes.push(straightened);
    this.currentStroke = null;
    return straightened;



    this.discardStroke();
    return null;
  }

  discardStroke(): void {
    this.currentStroke = null;
  }

  private calculateStrokeLength(): number {
    if (!this.currentStroke || this.currentStroke.points.length < 2) return 0;

    let length = 0;
    for (let i = 1; i < this.currentStroke.points.length; i++) {
      length += this.distance(
        this.currentStroke.points[i - 1],
        this.currentStroke.points[i]
      );
    }
    return length;
  }

  getCurrentStroke(): Stroke | null {
    return this.currentStroke;
  }

  clearAll(): void {
    this.currentStroke = null;
    this.completedStrokes = [];
    this.clearLivePosition();
    this.clear();
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(): void {
    this.clear();

    // Render completed strokes (faded)
    for (const stroke of this.completedStrokes) {
      this.renderStroke(stroke, 0.3);
    }

    // Render current stroke with live extension to finger position
    if (this.currentStroke && this.currentStroke.points.length >= 1) {
      this.renderStrokeWithLiveExtension(this.currentStroke, 1.0);
    }
  }

  private renderStrokeWithLiveExtension(stroke: Stroke, alpha: number): void {
    if (stroke.points.length === 0) return;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = stroke.color;
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // Build points array including live position
    let points = [...stroke.points];
    if (this.livePosition) {
      points.push(this.livePosition);
    }

    // If only one point, draw a dot
    if (points.length === 1) {
      this.ctx.beginPath();
      this.ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      return;
    }

    this.renderWeldingEffect(stroke, alpha, true);
    this.ctx.restore();
  }

  public renderStroke(stroke: Stroke, alpha: number): void {
    if (stroke.points.length === 0) return;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = stroke.color;
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // If only one point, draw a dot
    if (stroke.points.length === 1) {
      this.ctx.beginPath();
      this.ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      return;
    }

    this.renderWeldingEffect(stroke, alpha * 0.6, false);
    this.ctx.restore();
  }

  private renderWeldingEffect(stroke: Stroke, alpha: number, isLive: boolean): void {
    if (stroke.points.length === 0) return;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;

    // Points for path (add live for live drawing)
    let points: Point2D[] = [...stroke.points];
    if (stroke.closed) {
      points.push(stroke.points[0]);
    }
    if (isLive && this.livePosition) {
      points.push(this.livePosition);
    }

    // Single point - glow spark dot
    if (points.length === 1) {
      const grad = this.ctx.createRadialGradient(points[0].x, points[0].y, 0, points[0].x, points[0].y, stroke.width * 1.5);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#ffff44');
      grad.addColorStop(1, 'transparent');
      this.ctx.shadowBlur = 12;
      this.ctx.shadowColor = '#ffffff';
      this.ctx.fillStyle = grad;
      this.ctx.beginPath();
      this.ctx.arc(points[0].x, points[0].y, stroke.width * 1.5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      return;
    }

    // Multi-layer glow passes
    const glowColors = WELDING.GLOW_COLORS;
    const blurs = WELDING.GLOW_BLURS;
    const mults = WELDING.GLOW_WIDTH_MULTIPLIERS;
    for (let l = 0; l < glowColors.length; l++) {
      this.ctx.save();
      this.ctx.strokeStyle = glowColors[l];
      this.ctx.shadowColor = glowColors[l];
      this.ctx.shadowBlur = blurs[l];
      this.ctx.shadowOffsetX = (Math.random() - 0.5) * 4;
      this.ctx.shadowOffsetY = (Math.random() - 0.5) * 4;
      this.ctx.lineWidth = stroke.width * mults[l];
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.drawSmoothCurve(points);
      this.ctx.stroke();
      this.ctx.restore();
    }

    // Sparks along stroke
    const density = WELDING.SPARK_DENSITY;
    const minSize = WELDING.SPARK_MIN_SIZE;
    const maxSize = WELDING.SPARK_MAX_SIZE;
    for (let i = 1; i < stroke.points.length; i += 4) {
      if (Math.random() < density) {
        const x = (stroke.points[i-1].x + stroke.points[i].x) / 2 + (Math.random() - 0.5) * stroke.width;
        const y = (stroke.points[i-1].y + stroke.points[i].y) / 2 + (Math.random() - 0.5) * stroke.width;
        const size = minSize + Math.random() * (maxSize - minSize);
        const sparkGrad = this.ctx.createRadialGradient(x, y, 0, x, y, size);
        sparkGrad.addColorStop(0, '#ffffff');
        sparkGrad.addColorStop(0.4, '#ffaa00');
        sparkGrad.addColorStop(1, 'transparent');
        this.ctx.save();
        this.ctx.shadowBlur = 6;
        this.ctx.shadowColor = '#ffffff';
        this.ctx.fillStyle = sparkGrad;
        this.ctx.beginPath();
        this.ctx.arc(x, y, size, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
      }
    }

    // Tip spark for live
    if (isLive && this.livePosition) {
      const x = this.livePosition.x;
      const y = this.livePosition.y;
      const size = WELDING.SPARK_MAX_SIZE * WELDING.TIP_SPARK_MULTIPLIER;
      const tipGrad = this.ctx.createRadialGradient(x, y, 0, x, y, size);
      tipGrad.addColorStop(0, '#ffffff');
      tipGrad.addColorStop(0.3, '#ffff00');
      tipGrad.addColorStop(1, 'transparent');
      this.ctx.save();
      this.ctx.shadowBlur = 20;
      this.ctx.shadowColor = '#ffffff';
      this.ctx.fillStyle = tipGrad;
      this.ctx.beginPath();
      this.ctx.arc(x, y, size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    // Sharp core in stroke color
    this.ctx.strokeStyle = stroke.color;
    this.ctx.shadowBlur = 0;
    this.ctx.lineWidth = stroke.width;
    this.drawSmoothCurve(points);
    this.ctx.stroke();

    this.ctx.restore();
  }

  // Smooth curve using cubic bezier with calculated control points
  private drawSmoothCurve(points: Point2D[]): void {
    if (points.length < 2) return;

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      this.ctx.lineTo(points[1].x, points[1].y);
      return;
    }

    // Use quadratic curves through midpoints for smooth result
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      if (i === 0) {
        // First segment: line to midpoint
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        this.ctx.lineTo(midX, midY);
      } else if (i === points.length - 2) {
        // Last segment: curve to end point
        this.ctx.quadraticCurveTo(p0.x, p0.y, p1.x, p1.y);
      } else {
        // Middle segments: curve to midpoint
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        this.ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
    }
  }

  renderClosingAnimation(stroke: Stroke, progress: number): void {
    if (stroke.points.length < 2) return;

    this.clear();

    // Render the stroke with pulsing effect
    const pulseScale = 1 + Math.sin(progress * Math.PI) * 0.1;
    const pulseAlpha = 0.5 + Math.sin(progress * Math.PI * 2) * 0.5;

    this.ctx.save();

    // Draw glow
    this.ctx.globalAlpha = pulseAlpha * 0.3;
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.width * pulseScale * 2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.filter = 'blur(8px)';

    this.drawStrokePath(stroke);
    this.ctx.stroke();

    // Draw main stroke
    this.ctx.filter = 'none';
    this.ctx.globalAlpha = 1;
    this.ctx.lineWidth = stroke.width * pulseScale;

    this.drawStrokePath(stroke);
    this.ctx.stroke();

    this.ctx.restore();
  }

  private drawStrokePath(stroke: Stroke): void {
    let points = [...stroke.points];
    if (stroke.closed) {
      points.push(stroke.points[0]);  // Close the loop
    }
    this.drawSmoothCurve(points);
  }

  removeCompletedStroke(stroke: Stroke): void {
    const index = this.completedStrokes.indexOf(stroke);
    if (index > -1) {
      this.completedStrokes.splice(index, 1);
    }
  }

  addCompletedStroke(stroke: Stroke): void {
    this.completedStrokes.push(stroke);
  }

  getCompletedStrokes(): Stroke[] {
    return this.completedStrokes;
  }
}

