import { useState, type CSSProperties } from 'react';

const SPARKLE_COLORS = ['#e8c987', '#8ccdf2', '#f4efe2', '#d8b56f'];
const SPARKLE_COUNT = 16;

interface SparkleSpec {
  color: string;
  delayMs: number;
  durationMs: number;
  dx: number;
  dy: number;
  scale: number;
  size: number;
}

function buildSparkles(): SparkleSpec[] {
  return Array.from({ length: SPARKLE_COUNT }, (_, index) => {
    const angle = (Math.PI * 2 * index) / SPARKLE_COUNT + Math.random() * 0.7;
    const distance = 46 + Math.random() * 92;
    return {
      color: SPARKLE_COLORS[index % SPARKLE_COLORS.length],
      delayMs: Math.random() * 150,
      durationMs: 560 + Math.random() * 320,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance * 0.8 - 30,
      scale: 0.7 + Math.random() * 0.9,
      size: 6 + Math.random() * 6,
    };
  });
}

/**
 * One time-boxed burst of glitter around the book spine. Remount (via key)
 * for a new burst; the parent unmounts it when the triggering animation ends,
 * so idle DOM stays free of animated nodes.
 */
export function PromptBookSparkles() {
  const [sparkles] = useState(buildSparkles);

  return (
    <div className="fb-prompt-book-sparkles" aria-hidden="true">
      {sparkles.map((sparkle, index) => (
        <span
          className="fb-prompt-book-sparkle"
          key={index}
          style={{
            '--fb-sparkle-color': sparkle.color,
            '--fb-sparkle-delay': `${Math.round(sparkle.delayMs)}ms`,
            '--fb-sparkle-duration': `${Math.round(sparkle.durationMs)}ms`,
            '--fb-sparkle-dx': `${Math.round(sparkle.dx)}px`,
            '--fb-sparkle-dy': `${Math.round(sparkle.dy)}px`,
            '--fb-sparkle-scale': sparkle.scale.toFixed(2),
            '--fb-sparkle-size': `${sparkle.size.toFixed(1)}px`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
