import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { toLocal3D } from "../../lib/math/geoToLocal";
import type { AltitudeMode, FlightPoint } from "../../types/flight";

interface Viewer3DProps {
  points: FlightPoint[];
  altitudeMode: AltitudeMode;
  zScale: number;
  selectedIndex: number;
  currentIndex: number;
  pointSize: number;
  pointStride: number;
  onSelect: (index: number) => void;
}

interface MarkerData {
  index: number;
  role: "start" | "middle" | "end";
  isCurrent: boolean;
  isSelected: boolean;
  position: [number, number, number];
}

interface AxisLine {
  color: string;
  midpoint: [number, number, number];
  quaternion: [number, number, number, number];
  length: number;
}

interface AxisTick {
  axis: "x" | "y" | "z";
  value: number;
  position: [number, number, number];
  scale: [number, number, number];
  labelOffset: [number, number, number];
}

function markerColor(marker: MarkerData): string {
  if (marker.isCurrent) {
    return "#ffe164";
  }
  if (marker.isSelected) {
    return "#ffffff";
  }
  if (marker.role === "start") {
    return "#42d26f";
  }
  if (marker.role === "end") {
    return "#ff6058";
  }
  return "#7bc2ff";
}

function markerRadius(marker: MarkerData, pointSize: number): number {
  if (marker.isCurrent) {
    return 1.9 * pointSize;
  }
  if (marker.isSelected) {
    return 1.7 * pointSize;
  }
  if (marker.role === "start" || marker.role === "end") {
    return 1.5 * pointSize;
  }
  return 1.05 * pointSize;
}

function buildAxisLine(start: THREE.Vector3, end: THREE.Vector3, color: string): AxisLine {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize()
  );

  return {
    color,
    midpoint: [midpoint.x, midpoint.y, midpoint.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    length
  };
}

function chooseTickStep(maxAbs: number): number {
  const raw = maxAbs <= 0 ? 1 : maxAbs / 6;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const multipliers = [1, 2, 5, 10];
  for (const multiplier of multipliers) {
    const step = multiplier * magnitude;
    if (step >= raw) {
      return step;
    }
  }
  return magnitude;
}

function formatTick(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(Math.abs(Math.log10(step))));
  const text = value.toFixed(decimals);
  return text.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function Viewer3D({
  points,
  altitudeMode,
  zScale,
  selectedIndex,
  currentIndex,
  pointSize,
  pointStride,
  onSelect
}: Viewer3DProps) {
  const localPoints = useMemo(() => toLocal3D(points, altitudeMode, zScale), [points, altitudeMode, zScale]);

  const sceneData = useMemo(() => {
    if (localPoints.length === 0) {
      return {
        vectors: [] as THREE.Vector3[],
        markers: [] as MarkerData[],
        axisLines: [] as AxisLine[],
        axisTicks: [] as AxisTick[],
        tickStep: 1,
        axisLength: 50,
        tubeCurve: null as THREE.CatmullRomCurve3 | null,
        cameraTarget: [0, 0, 0] as [number, number, number],
        cameraDistance: 120
      };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    const vectors = localPoints.map((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      minZ = Math.min(minZ, point.z);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
      maxZ = Math.max(maxZ, point.z);
      return new THREE.Vector3(point.x, point.y, point.z);
    });

    const includeIndexes = new Set<number>();
    points.forEach((_, index) => {
      if (index === 0 || index === points.length - 1 || index % pointStride === 0) {
        includeIndexes.add(index);
      }
      if (index === selectedIndex || index === currentIndex) {
        includeIndexes.add(index);
      }
    });

    const markers: MarkerData[] = [];
    includeIndexes.forEach((index) => {
      const v = vectors[index];
      if (!v) {
        return;
      }
      markers.push({
        index,
        role: index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
        isCurrent: index === currentIndex,
        isSelected: index === selectedIndex,
        position: [v.x, v.y, v.z]
      });
    });

    const maxAbs = Math.max(
      Math.abs(minX),
      Math.abs(maxX),
      Math.abs(minY),
      Math.abs(maxY),
      Math.abs(minZ),
      Math.abs(maxZ),
      10
    );
    const axisLength = Math.ceil((maxAbs + 10) / 10) * 10;
    const tickStep = chooseTickStep(axisLength);

    const axisLines = [
      buildAxisLine(new THREE.Vector3(-axisLength, 0, 0), new THREE.Vector3(axisLength, 0, 0), "#ff7b7b"),
      buildAxisLine(new THREE.Vector3(0, -axisLength, 0), new THREE.Vector3(0, axisLength, 0), "#72f39a"),
      buildAxisLine(new THREE.Vector3(0, 0, -axisLength), new THREE.Vector3(0, 0, axisLength), "#79a9ff")
    ];

    const axisTicks: AxisTick[] = [];
    const tickCount = Math.floor((axisLength * 2) / tickStep);
    for (let i = 0; i <= tickCount; i += 1) {
      const value = -axisLength + i * tickStep;
      axisTicks.push({
        axis: "x",
        value,
        position: [value, 0, 0],
        scale: [0.22, 2.3, 0.22],
        labelOffset: [0, -4.2, 0]
      });
      axisTicks.push({
        axis: "y",
        value,
        position: [0, value, 0],
        scale: [2.3, 0.22, 0.22],
        labelOffset: [4.2, 0, 0]
      });
      axisTicks.push({
        axis: "z",
        value,
        position: [0, 0, value],
        scale: [2.3, 0.22, 0.22],
        labelOffset: [4.2, 0, 0]
      });
    }

    const tubeCurve = vectors.length > 1 ? new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.25) : null;
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 80);
    const cameraTarget: [number, number, number] = [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    ];

    return {
      vectors,
      markers,
      axisLines,
      axisTicks,
      tickStep,
      axisLength,
      tubeCurve,
      cameraTarget,
      cameraDistance: span * 1.45
    };
  }, [localPoints, points, pointStride, selectedIndex, currentIndex]);

  return (
    <div className="viewer-canvas viewer-3d">
      <Canvas
        onCreated={({ camera }) => {
          camera.up.set(0, 0, 1);
        }}
        camera={{
          position: [
            sceneData.cameraTarget[0] + sceneData.cameraDistance,
            sceneData.cameraTarget[1] - sceneData.cameraDistance,
            sceneData.cameraTarget[2] + sceneData.cameraDistance * 0.78
          ],
          fov: 52,
          near: 0.1,
          far: 100000
        }}
      >
        <color attach="background" args={["#0f1d2f"]} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[120, 80, 140]} intensity={0.85} />
        <directionalLight position={[-120, -80, 80]} intensity={0.35} />

        {sceneData.tubeCurve ? (
          <mesh>
            <tubeGeometry
              args={[
                sceneData.tubeCurve,
                Math.max(sceneData.vectors.length * 2, 120),
                Math.max(0.35, 0.58 * pointSize),
                14,
                false
              ]}
            />
            <meshStandardMaterial color="#38c4ff" metalness={0.15} roughness={0.32} />
          </mesh>
        ) : null}

        {sceneData.markers.map((marker) => (
          <mesh
            key={marker.index}
            position={marker.position}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(marker.index);
            }}
          >
            <sphereGeometry args={[markerRadius(marker, pointSize), 20, 20]} />
            <meshStandardMaterial
              color={markerColor(marker)}
              emissive={marker.isCurrent ? "#8f6f11" : marker.isSelected ? "#6f6f6f" : "#000000"}
              emissiveIntensity={marker.isCurrent || marker.isSelected ? 0.5 : 0}
              metalness={0.12}
              roughness={0.42}
            />
          </mesh>
        ))}

        {sceneData.axisLines.map((axis) => (
          <mesh
            key={`${axis.color}-${axis.length}`}
            position={axis.midpoint}
            quaternion={axis.quaternion}
          >
            <cylinderGeometry args={[0.18, 0.18, axis.length, 10]} />
            <meshStandardMaterial color={axis.color} />
          </mesh>
        ))}

        {sceneData.axisTicks.map((tick, idx) => (
          <group key={`${tick.axis}-${tick.value}-${idx}`} position={tick.position}>
            <mesh scale={tick.scale}>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color="#8ea9bf" />
            </mesh>
            <Html
              position={tick.labelOffset}
              center
              style={{
                color: "#d6e4f1",
                fontSize: "10px",
                fontWeight: "600",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                textShadow: "0 0 6px rgba(0,0,0,0.7)"
              }}
            >
              {`${formatTick(tick.value, sceneData.tickStep)}m`}
            </Html>
          </group>
        ))}

        <Html
          position={[sceneData.axisLength + 8, 0, 0]}
          center
          style={{ color: "#ff9c9c", fontSize: "12px", fontWeight: "700", pointerEvents: "none" }}
        >
          X (m)
        </Html>
        <Html
          position={[0, sceneData.axisLength + 8, 0]}
          center
          style={{ color: "#92f2b5", fontSize: "12px", fontWeight: "700", pointerEvents: "none" }}
        >
          Y (m)
        </Html>
        <Html
          position={[0, 0, sceneData.axisLength + 8]}
          center
          style={{ color: "#9dbfff", fontSize: "12px", fontWeight: "700", pointerEvents: "none" }}
        >
          Z (m)
        </Html>

        <OrbitControls
          makeDefault
          enablePan={true}
          enableRotate={true}
          enableZoom={true}
          dampingFactor={0.08}
          target={sceneData.cameraTarget}
        />
      </Canvas>
    </div>
  );
}
