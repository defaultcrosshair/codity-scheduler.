import { useEffect, useRef } from 'react';

export default function InteractiveGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const spacing = 24; // dense crisp spacing for dots
    let cols = 0;
    let rows = 0;

    interface GridNode {
      x: number;
      y: number;
      blueIntensity: number; // bioluminescent excitation level (0 to 1)
    }

    let nodes: GridNode[][] = [];

    const initGrid = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;

      cols = Math.ceil(width / spacing) + 1;
      rows = Math.ceil(height / spacing) + 1;
      nodes = [];

      for (let i = 0; i < cols; i++) {
        nodes[i] = [];
        for (let j = 0; j < rows; j++) {
          nodes[i][j] = {
            x: i * spacing,
            y: j * spacing,
            blueIntensity: 0,
          };
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.active = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
      mouseRef.current.x = -1000;
      mouseRef.current.y = -1000;
    };

    const handleResize = () => {
      initGrid();
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    initGrid();

    // Loop
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const mActive = mouseRef.current.active;

      // Draw all nodes and compute physics
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const n = nodes[i][j];

          // Compute bioluminescence excitation
          if (mActive) {
            const dx = mx - n.x;
            const dy = my - n.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 80) {
              // Excite node based on cursor proximity
              const excitation = (80 - dist) / 80;
              n.blueIntensity = Math.max(n.blueIntensity, excitation);
            }
          }

          // Exponential decay loop for trail effect
          n.blueIntensity *= 0.94;
          if (n.blueIntensity < 0.005) {
            n.blueIntensity = 0;
          }

          // Render dot
          ctx.beginPath();
          if (n.blueIntensity > 0) {
            // Draw excited glowing blue dot layer
            const radius = 1.2 + n.blueIntensity * 1.0; // expand size slightly when glowing
            ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(37, 99, 235, ${0.1 + n.blueIntensity * 0.75})`;
          } else {
            // Draw faint subtle gray base dot layer
            ctx.arc(n.x, n.y, 1.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(17, 24, 39, 0.035)';
          }
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        pointerEvents: 'none',
        display: 'block',
      }}
    />
  );
}
