import { Point2D, Stroke, ShapeType } from './types';
import { STROKE } from './constants';

export interface ShapeAnalysisResult {
  shapeType: ShapeType;
  confidence: number;
  feedback: string;
  isClosed: boolean;
  sectorsWithPoints?: number;
}

export function analyzeShape(points: Point2D[]): ShapeAnalysisResult {
  if (points.length < 2) {
    return { shapeType: 'freehand', confidence: 0, feedback: 'Too few points', isClosed: false };
  }

  // Calculate centroid
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const centerX = sumX / points.length;
  const centerY = sumY / points.length;

  // Average radius and consistency
  let sumRadius = 0;
  const radii: number[] = [];
  for (const p of points) {
    const r = Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2));
    radii.push(r);
    sumRadius += r;
  }
  const avgRadius = sumRadius / points.length;
  let variance = 0;
  for (const r of radii) {
    variance += Math.pow(r - avgRadius, 2);
  }
  variance /= points.length;
  const stdDev = Math.sqrt(variance);
  const radiusConsistency = avgRadius > 0 ? Math.max(0, 1 - (stdDev / avgRadius)) : 0;
  const radiusPercent = Math.round(radiusConsistency * 100);

  // Angular sectors (12 = 30°)
  const numSectors = 12;
  const sectorCounts = new Array(numSectors).fill(0);
  for (const p of points) {
    const angle = Math.atan2(p.y - centerY, p.x - centerX);
    const normalizedAngle = angle < 0 ? angle + Math.PI * 2 : angle;
    const sectorIndex = Math.floor((normalizedAngle / (Math.PI * 2)) * numSectors) % numSectors;
    sectorCounts[sectorIndex]++;
  }
  const threshold = points.length * 0.05;
  let sectorsWithPoints = 0;
  for (const count of sectorCounts) {
    if (count >= threshold) sectorsWithPoints++;
  }
  const angularScore = Math.round((sectorsWithPoints / numSectors) * 100);

  // Closure
  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  const distanceStartEnd = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));
  const closureThreshold = avgRadius * 0.4;
  const isClosed = distanceStartEnd < closureThreshold;
  const closurePercent = avgRadius > 0 ? Math.max(0, 100 - (distanceStartEnd / avgRadius) * 100) : 0;

  const combinedScore = Math.round((angularScore * 0.5) + (radiusPercent * 0.3) + (closurePercent * 0.2));

  // Determine shape
  let shapeType: ShapeType = 'freehand';
  let feedback = '';
  if (angularScore >= 75 && radiusPercent >= 50 && isClosed) {
    shapeType = 'circle';
    feedback = 'Perfect circle!';
  } else if (sectorsWithPoints <= 4 && radiusPercent >= 40) {
    shapeType = 'square';
    feedback = 'Nice square!';
  } else if (sectorsWithPoints <= 3 && radiusPercent >= 35) {
    shapeType = 'triangle';
    feedback = 'Good triangle!';
  } else if (angularScore >= 60 && radiusPercent < 45) {
    shapeType = 'circle'; // oval as circle
    feedback = 'Good circle!';
  } else if (angularScore >= 50 && radiusPercent < 40) {
    shapeType = 'square';
    feedback = 'Rectangle!';
  } else {
    feedback = 'Freehand shape';
  }

  return {
    shapeType,
    confidence: combinedScore,
    feedback,
    isClosed,
    sectorsWithPoints
  };
}

export function generatePerfectShape(shapeType: ShapeType, original: Stroke): Stroke {
  if (original.points.length === 0) return original;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of original.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const size = Math.max(maxX - minX, maxY - minY) * 0.8; // 80% of bbox

  let points: Point2D[] = [];

  switch (shapeType) {
    case 'circle':
      const radius = size / 2;
      const numPoints = 32;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        points.push({
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius
        });
      }
      break;

    case 'square':
      const halfSize = size / 2;
      points = [
        { x: centerX - halfSize, y: centerY - halfSize },
        { x: centerX + halfSize, y: centerY - halfSize },
        { x: centerX + halfSize, y: centerY + halfSize },
        { x: centerX - halfSize, y: centerY + halfSize },
        { x: centerX - halfSize, y: centerY - halfSize } // close
      ];
      break;

    case 'triangle':
      const height = size * Math.sqrt(3) / 2;
      points = [
        { x: centerX, y: centerY - height / 2 },
        { x: centerX - size / 2, y: centerY + height / 2 },
        { x: centerX + size / 2, y: centerY + height / 2 },
        { x: centerX, y: centerY - height / 2 } // close
      ];
      break;

    default:
      return original; // fallback
  }

  return {
    ...original,
    points,
    shapeType,
    closed: true
  };
}

// straightenStroke convenience wrapper
export function straightenStroke(stroke: Stroke, threshold: number = 70): Stroke {
  if (stroke.points.length < 10) return stroke; // min points

  const analysis = analyzeShape(stroke.points);
  if (analysis.confidence > threshold && analysis.isClosed) {
    return generatePerfectShape(analysis.shapeType, stroke);
  }
  return stroke;
}

