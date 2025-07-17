import React, { useRef, useEffect, useCallback } from 'react';
import { ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData, InteractionMode, SimulationCanvasHandle } from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER
} from '../constants';

// Cache for the particle texture to avoid recreating it
let particleTextureCache: any = null;

// Creates a soft, radial gradient texture for the particles
const createParticleTexture = (THREE: any) => {
    if (particleTextureCache) return particleTextureCache;
    if (!THREE || typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);

    particleTextureCache = new THREE.CanvasTexture(canvas);
    return particleTextureCache;
};

// Calculates CME opacity based on speed (km/s)
const getCmeOpacity = (speed: number): number => {
    const THREE = window.THREE;
    if (!THREE) return 0.1; // Default opacity if THREE is not loaded

    const minSpeed = 300;
    const maxSpeed = 3000;
    const minOpacity = 0.01;
    const maxOpacity = 0.60;

    // Clamp speed to the defined range before mapping
    const clampedSpeed = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);

    // Map the clamped speed to the opacity range
    return THREE.MathUtils.mapLinear(clampedSpeed, minSpeed, maxSpeed, minOpacity, maxOpacity);
};

// Calculates CME particle count based on speed (km/s)
const getCmeParticleCount = (speed: number): number => {
    const THREE = window.THREE;
    if (!THREE) return 4000; // Default if THREE isn't loaded

    const minSpeed = 300;
    const maxSpeed = 3000;
    const minParticles = 1500;
    const maxParticles = 7000;

    const clampedSpeed = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
    const particleCount = THREE.MathUtils.mapLinear(clampedSpeed, minSpeed, maxSpeed, minParticles, maxParticles);
    
    return Math.floor(particleCount);
};

// Calculates CME particle size based on speed (km/s)
const getCmeParticleSize = (speed: number, scale: number): number => {
    const THREE = window.THREE;
    if (!THREE) return 0.05 * scale; // Default size

    const minSpeed = 300;
    const maxSpeed = 3000;
    const minSize = 0.04 * scale;
    const maxSize = 0.08 * scale;

    const clampedSpeed = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
    
    return THREE.MathUtils.mapLinear(clampedSpeed, minSpeed, maxSpeed, minSize, maxSize);
};

// Determines the core color of the CME based on its speed
const getCmeCoreColor = (speed: number): any /* THREE.Color */ => {
    const THREE = window.THREE;
    if (!THREE) return new (class { constructor(hex: any) {} setHex() { return this; } })(0xffffff); // Default color

    if (speed >= 2500) {
        return new THREE.Color(0xff69b4); // Hot Pink
    } else if (speed >= 1800) {
        return new THREE.Color(0x9370db); // Medium Purple
    } else if (speed >= 1000) {
        return new THREE.Color(0xff4500); // OrangeRed
    } else if (speed >= 800) {
        return new THREE.Color(0xffa500); // Orange
    } else if (speed >= 500) {
        return new THREE.Color(0xffff00); // Yellow
    } else if (speed < 350) {
        return new THREE.Color(0x808080); // Grey
    } else {
        // Linear interpolation for speeds between 350 and 500 for a smooth transition
        const grey = new THREE.Color(0x808080);
        const yellow = new THREE.Color(0xffff00);
        const t = THREE.MathUtils.mapLinear(speed, 350, 500, 0, 1);
        return grey.lerp(yellow, t);
    }
};


interface SimulationCanvasProps {
  cmeData: ProcessedCME[];
  activeView: ViewMode;
  focusTarget: FocusTarget | null;
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void;
  timelineActive: boolean;
  timelinePlaying: boolean;
  timelineSpeed: number;
  timelineValue: number; // 0-1000
  timelineMinDate: number;
  timelineMaxDate: number;
  setPlanetMeshesForLabels: (labels: PlanetLabelInfo[]) => void;
  setRendererDomElement: (element: HTMLCanvasElement) => void;
  onCameraReady: (camera: any) => void; // Pass camera up for labels
  getClockElapsedTime: () => number;
  resetClock: () => void;
  onScrubberChangeByAnim: (value: number) => void;
  onTimelineEnd: () => void;
  showExtraPlanets: boolean;
  showMoonL1: boolean;
  dataVersion: number;
  interactionMode: InteractionMode;
}

const SimulationCanvas: React.ForwardRefRenderFunction<SimulationCanvasHandle, SimulationCanvasProps> = (props, ref) => {
  const {
    cmeData,
    activeView,
    focusTarget,
    currentlyModeledCMEId,
    onCMEClick,
    timelineActive,
    timelinePlaying,
    timelineSpeed,
    timelineValue,
    timelineMinDate,
    timelineMaxDate,
    setPlanetMeshesForLabels,
    setRendererDomElement,
    onCameraReady,
    getClockElapsedTime,
    resetClock,
    onScrubberChangeByAnim,
    onTimelineEnd,
    showExtraPlanets,
    showMoonL1,
    dataVersion,
    interactionMode,
  } = props;
    
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null); // THREE.WebGLRenderer
  const sceneRef = useRef<any>(null); // THREE.Scene
  const cameraRef = useRef<any>(null); // THREE.PerspectiveCamera
  const controlsRef = useRef<any>(null); // THREE.OrbitControls
  const cmeGroupRef = useRef<any>(null); // THREE.Group
  const celestialBodiesRef = useRef<Record<string, CelestialBody>>({});
  const orbitsRef = useRef<Record<string, any>>({}); // Record<string, THREE.Line>
  const predictionLineRef = useRef<any>(null); // THREE.Line
  
  const timelineValueRef = useRef(timelineValue);
  const lastTimeRef = useRef(0);

  // Use a ref to hold props that the animation loop needs access to.
  // This avoids issues with stale closures in the requestAnimationFrame loop.
  const animPropsRef = useRef({ onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate });
  const interactionRef = useRef({ onCMEClick, interactionMode });

  useEffect(() => {
    animPropsRef.current = { onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate };
  }, [onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate]);

  useEffect(() => {
    interactionRef.current = { onCMEClick, interactionMode };
  }, [onCMEClick, interactionMode]);


  const THREE = window.THREE; // Access THREE from global scope
  const gsap = window.gsap; // Access GSAP from global scope
  
  useEffect(() => {
    timelineValueRef.current = timelineValue;
  }, [timelineValue]);

  const calculateDistance = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number, useDeceleration: boolean): number => {
    const speed_km_per_sec = cme.speed;
    const speed_AU_per_sec = speed_km_per_sec / AU_IN_KM;

    // If using deceleration model based on predicted Earth arrival
    if (cme.isEarthDirected && cme.predictedArrivalTime && useDeceleration) {
        const earthOrbitRadiusActualAU = PLANET_DATA_MAP.EARTH.radius / SCENE_SCALE;
        const totalTravelTimeSeconds = (cme.predictedArrivalTime.getTime() - cme.startTime.getTime()) / 1000;

        if (totalTravelTimeSeconds <= 0) return 0;
        
        const proportionOfTravel = Math.min(1.0, timeSinceEventSeconds / totalTravelTimeSeconds);
        const distanceActualAU = proportionOfTravel * earthOrbitRadiusActualAU;
        return distanceActualAU * SCENE_SCALE;
    }
    
    const distanceActualAU = speed_AU_per_sec * timeSinceEventSeconds;
    const distanceSceneUnits = distanceActualAU * SCENE_SCALE;
    
    return distanceSceneUnits;

  }, []); 


  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number) => {
    if (!THREE) return;
    
    const sunRadius = PLANET_DATA_MAP.SUN.size;

    // The CME is only visible once its front has passed the Sun's surface.
    if (distTraveledInSceneUnits <= sunRadius) {
        cmeObject.visible = false;
        return;
    }
    
    cmeObject.visible = true;
    
    // The CME's visible length is the distance its front has traveled beyond the surface.
    const cmeLength = distTraveledInSceneUnits - sunRadius;

    // The CME's local +Y is its direction of travel. Get this direction in world space.
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);

    // Position the tip of the particle cone at the Sun's surface.
    const tipPosition = direction.clone().multiplyScalar(sunRadius);
    cmeObject.position.copy(tipPosition);

    // Scale the unit cone to its current length. The width also scales with length to maintain the cone shape.
    cmeObject.scale.set(cmeLength, cmeLength, cmeLength);

  }, [THREE]);


  // Initialize Scene
  useEffect(() => {
    if (!mountRef.current || !THREE) return;
    if (rendererRef.current) return; // Already initialized

    resetClock();
    lastTimeRef.current = getClockElapsedTime();


    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.001 * SCENE_SCALE, 100 * SCENE_SCALE);
    cameraRef.current = camera;
    onCameraReady(camera); // Pass camera up to App
   
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    setRendererDomElement(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 2.5, 200 * SCENE_SCALE); 
    scene.add(pointLight);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.1 * SCENE_SCALE;
    controls.maxDistance = 50 * SCENE_SCALE;
    controlsRef.current = controls;

    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    const starVertices = [];
    for (let i = 0; i < 15000; i++) { 
      starVertices.push(THREE.MathUtils.randFloatSpread(300 * SCENE_SCALE)); 
      starVertices.push(THREE.MathUtils.randFloatSpread(300 * SCENE_SCALE)); 
      starVertices.push(THREE.MathUtils.randFloatSpread(300 * SCENE_SCALE)); 
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.01 * SCENE_SCALE, sizeAttenuation: true }); 
    const starField = new THREE.Points(starGeometry, starMaterial);
    scene.add(starField);

    const sunGeometry = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
    const sunMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SUN_VERTEX_SHADER,
      fragmentShader: SUN_FRAGMENT_SHADER,
    });
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    const planetLabelInfos: PlanetLabelInfo[] = [{id: 'sun-label', name: 'Sun', mesh: sunMesh}];
    
    // Create bodies that orbit the Sun
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return; // Skip sun and moons for now
      
      const planetGeometry = new THREE.SphereGeometry(data.size, 32, 32);
      const planetMaterial = new THREE.MeshPhongMaterial({ color: data.color, shininess: 30 });
      const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
      // Corrected Coordinate System: 0 angle on +Z axis
      planetMesh.position.x = data.radius * Math.sin(data.angle);
      planetMesh.position.z = data.radius * Math.cos(data.angle);
      planetMesh.userData = data; // Store data for animation
      scene.add(planetMesh);
      celestialBodiesRef.current[name] = { mesh: planetMesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({id: data.labelElementId, name: data.name, mesh: planetMesh});

      if (name === 'EARTH') {
        const earthData = data as PlanetData;
        // Atmosphere
        const atmosphereGeo = new THREE.SphereGeometry(earthData.size * 1.2, 32, 32); 
        const atmosphereMat = new THREE.ShaderMaterial({
          vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER,
          fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          transparent: true,
          uniforms: { uImpactTime: { value: 0.0 }, uTime: { value: 0.0 } }
        });
        const atmosphereMesh = new THREE.Mesh(atmosphereGeo, atmosphereMat);
        atmosphereMesh.name = 'atmosphere'; // Name it for identification
        planetMesh.add(atmosphereMesh);

        // Aurora
        const auroraGeo = new THREE.SphereGeometry(earthData.size * 1.25, 64, 64);
        const auroraMat = new THREE.ShaderMaterial({
            vertexShader: AURORA_VERTEX_SHADER,
            fragmentShader: AURORA_FRAGMENT_SHADER,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            uniforms: {
                uTime: { value: 0.0 },
                uCmeSpeed: { value: 0.0 },
                uImpactTime: { value: 0.0 }
            }
        });
        const auroraMesh = new THREE.Mesh(auroraGeo, auroraMat);
        auroraMesh.name = 'aurora';
        planetMesh.add(auroraMesh);
      }

      const orbitPoints = [];
      const orbitSegments = 128;
      for (let i = 0; i <= orbitSegments; i++) {
        const angle = (i / orbitSegments) * Math.PI * 2;
        // Corrected Coordinate System
        orbitPoints.push(new THREE.Vector3(Math.sin(angle) * data.radius, 0, Math.cos(angle) * data.radius));
      }
      const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
      const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x404040, transparent: true, opacity: 0.4 });
      const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
      scene.add(orbitLine);
      orbitsRef.current[name] = orbitLine;
    });

    // Create bodies that orbit other bodies (moons)
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
        if (!data.orbits) return; // Only process moons
        const parentBody = celestialBodiesRef.current[data.orbits];
        if (!parentBody) return; // Ensure parent exists

        const moonGeometry = new THREE.SphereGeometry(data.size, 16, 16);
        const moonMaterial = new THREE.MeshPhongMaterial({ color: data.color, shininess: 5 });
        const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
        // Corrected Coordinate System
        moonMesh.position.x = data.radius * Math.sin(data.angle);
        moonMesh.position.z = data.radius * Math.cos(data.angle);
        moonMesh.userData = data; // Store data for animation
        
        parentBody.mesh.add(moonMesh); // Add moon to its parent
        celestialBodiesRef.current[name] = { mesh: moonMesh, name: data.name, labelId: data.labelElementId, userData: data };
        planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: moonMesh });

        // Moon's orbit line
        const orbitPoints = [];
        const orbitSegments = 64;
        for (let i = 0; i <= orbitSegments; i++) {
            const angle = (i / orbitSegments) * Math.PI * 2;
            // Corrected Coordinate System
            orbitPoints.push(new THREE.Vector3(Math.sin(angle) * data.radius, 0, Math.cos(angle) * data.radius));
        }
        const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
        const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x525252, transparent: true, opacity: 0.5 });
        const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
        orbitLine.name = 'moon-orbit'; // Name for easy selection
        parentBody.mesh.add(orbitLine); // Add orbit line to parent
    });

    // Create Points of Interest (L1)
    Object.entries(POI_DATA_MAP).forEach(([name, data]) => {
        // Using a Tetrahedron for a simple satellite shape
        const poiGeometry = new THREE.TetrahedronGeometry(data.size, 0);
        const poiMaterial = new THREE.MeshBasicMaterial({ color: data.color });
        const poiMesh = new THREE.Mesh(poiGeometry, poiMaterial);
        poiMesh.userData = data;
        
        scene.add(poiMesh);
        celestialBodiesRef.current[name] = { mesh: poiMesh, name: data.name, labelId: data.labelElementId, userData: data };
        planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: poiMesh });
    });

    setPlanetMeshesForLabels(planetLabelInfos);


    const handleResize = () => {
      if (mountRef.current && cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    const onCanvasClick = (event: MouseEvent) => {
        const { onCMEClick: clickHandler, interactionMode: currentInteractionMode } = interactionRef.current;
        if (currentInteractionMode !== InteractionMode.SELECT) return;

        if (!mountRef.current || !cameraRef.current || !cmeGroupRef.current) return;
        
        const rect = mountRef.current.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / mountRef.current.clientWidth) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / mountRef.current.clientHeight) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        // Adjust raycaster threshold for points
        raycaster.params.Points.threshold = 0.1 * SCENE_SCALE;
        raycaster.setFromCamera(mouse, cameraRef.current);
        
        const intersects = raycaster.intersectObjects(cmeGroupRef.current.children, true);
        
        if (intersects.length > 0) {
            const firstIntersectedObject = intersects[0].object;
            if (firstIntersectedObject.userData && firstIntersectedObject.userData.id) {
                clickHandler(firstIntersectedObject.userData as ProcessedCME);
            }
        }
    };
    mountRef.current.addEventListener('click', onCanvasClick);


    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const {
        currentlyModeledCMEId,
        timelineActive,
        timelinePlaying,
        timelineSpeed,
        timelineMinDate,
        timelineMaxDate,
        onScrubberChangeByAnim,
        onTimelineEnd,
      } = animPropsRef.current;
      
      const elapsedTime = getClockElapsedTime();
      const delta = elapsedTime - lastTimeRef.current;
      lastTimeRef.current = elapsedTime;
      
      const ORBIT_SPEED_SCALE = 2000; // Visual speed up factor for orbits
      
      // Animate celestial bodies
      Object.values(celestialBodiesRef.current).forEach(body => {
        const bodyData = body.userData as PlanetData | undefined;
        if (!bodyData || !bodyData.orbitalPeriodDays) return;

        // The angular velocity is scaled up for visualization purposes
        const angularVelocity = (2 * Math.PI) / (bodyData.orbitalPeriodDays * 24 * 3600) * ORBIT_SPEED_SCALE;
        const angle = bodyData.angle + angularVelocity * elapsedTime;
        
        // Planets orbit the scene origin (0,0,0)
        if (!bodyData.orbits) {
            body.mesh.position.x = bodyData.radius * Math.sin(angle);
            body.mesh.position.z = bodyData.radius * Math.cos(angle);
        } 
        // Moons orbit their parent body (local coordinates)
        else {
            body.mesh.position.x = bodyData.radius * Math.sin(angle);
            body.mesh.position.z = bodyData.radius * Math.cos(angle);
        }
      });
      
      // Update L1 position
      const l1Body = celestialBodiesRef.current['L1'];
      const earthBody = celestialBodiesRef.current['EARTH'];
      if (l1Body && earthBody) {
          const earthPos = new THREE.Vector3();
          earthBody.mesh.getWorldPosition(earthPos);
          // Get direction from sun (origin) to earth
          const sunToEarthDir = earthPos.clone().normalize();
          const l1Data = l1Body.userData as POIData;
          // Position L1 between sun and earth
          const l1Pos = earthPos.clone().sub(sunToEarthDir.multiplyScalar(l1Data.distanceFromParent));
          l1Body.mesh.position.copy(l1Pos);
          l1Body.mesh.lookAt(earthPos); // Point satellite towards Earth
      }

      if (celestialBodiesRef.current.SUN) {
        (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsedTime;
      }
      if (celestialBodiesRef.current.EARTH) {
        // Rotate Earth on its axis
        celestialBodiesRef.current.EARTH.mesh.rotation.y += 0.05 * delta; // a bit slower rotation
        // Update shaders for atmosphere and aurora
        const earthMesh = celestialBodiesRef.current.EARTH.mesh;
        earthMesh.children.forEach(child => {
            if ((child as any).material?.uniforms?.uTime) {
                (child as any).material.uniforms.uTime.value = elapsedTime;
            }
        });
      }
      
      if (timelineActive) {
        if (timelinePlaying) {
            const timeRange = timelineMaxDate - timelineMinDate;
            if (timeRange > 0 && timelineValueRef.current < 1000) {
                const simHoursPerSecond = 3 * timelineSpeed;
                const simMillisPerSecond = simHoursPerSecond * 3600 * 1000;
                const simTimePassedThisFrame = delta * simMillisPerSecond;
                const valueToAdd = (simTimePassedThisFrame / timeRange) * 1000;
                
                const newValue = timelineValueRef.current + valueToAdd;

                if (newValue >= 1000) {
                    timelineValueRef.current = 1000;
                    onTimelineEnd();
                } else {
                    timelineValueRef.current = newValue;
                }
                onScrubberChangeByAnim(timelineValueRef.current);
            }
        }
        
        const currentTimelineTime = timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000);
        cmeGroupRef.current.children.forEach((cmeObject: any) => {
            const cme: ProcessedCME = cmeObject.userData;
            if (!cme) return;
            
            const timeSinceEventSeconds = (currentTimelineTime - cme.startTime.getTime()) / 1000;
            if (timeSinceEventSeconds < 0) {
                updateCMEShape(cmeObject, -1); 
            } else {
                const distSceneUnits = calculateDistance(cme, timeSinceEventSeconds, false); 
                updateCMEShape(cmeObject, distSceneUnits);
            }
        });

      } else {
         cmeGroupRef.current.children.forEach((cmeObject: any) => {
            const cme: ProcessedCME = cmeObject.userData;
            if (!cme) return;

            let currentDistSceneUnits = 0;
            if (currentlyModeledCMEId && cme.id === currentlyModeledCMEId) {
                const simStartTime = cme.simulationStartTime !== undefined ? cme.simulationStartTime : elapsedTime; 
                const timeSinceEventVisual = elapsedTime - simStartTime;
                currentDistSceneUnits = calculateDistance(cme, timeSinceEventVisual < 0 ? 0 : timeSinceEventVisual, true); 
            } 
            else if (!currentlyModeledCMEId) {
                const timeSinceEventAPI = (Date.now() - cme.startTime.getTime()) / 1000;
                currentDistSceneUnits = calculateDistance(cme, timeSinceEventAPI < 0 ? 0 : timeSinceEventAPI, false); 
            } else {
                updateCMEShape(cmeObject, -1);
                return;
            }
            updateCMEShape(cmeObject, currentDistSceneUnits);
        });
      }

      // Check for impacts and update effects
      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsedTime);

      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && rendererRef.current) {
         mountRef.current.removeEventListener('click', onCanvasClick);
         mountRef.current.removeChild(rendererRef.current.domElement);
      }
      if (particleTextureCache) {
          particleTextureCache.dispose();
          particleTextureCache = null;
      }
      rendererRef.current?.dispose();
      cancelAnimationFrame(animationFrameId);
      sceneRef.current?.traverse((object:any) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material:any) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      rendererRef.current = null; 
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE, dataVersion]);


  useEffect(() => {
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    while (cmeGroupRef.current.children.length > 0) {
      const child = cmeGroupRef.current.children[0];
      cmeGroupRef.current.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m:any) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }

    const particleTexture = createParticleTexture(THREE);

    cmeData.forEach(cme => {
      const particleCount = getCmeParticleCount(cme.speed);
      const positions = [];
      const colors = [];

      const coneHalfAngleRad = THREE.MathUtils.degToRad(cme.halfAngle);
      const coneHeight = 1; // Unit height for scaling
      const coneRadius = coneHeight * Math.tan(coneHalfAngleRad);

      const bulgeFactor = 0.5;

      const shockColor = new THREE.Color(0xffaaaa); 
      const wakeColor = new THREE.Color(0x8888ff); 
      const coreColor = getCmeCoreColor(cme.speed);

      for (let i = 0; i < particleCount; i++) {
        const y = coneHeight * Math.cbrt(Math.random()); 
        const radiusAtY = (y / coneHeight) * coneRadius;
        const theta = Math.random() * 2 * Math.PI;
        const r = coneRadius > 0 ? Math.sqrt(Math.random()) * radiusAtY : 0;

        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        
        // Parabolic rounding of the front face
        const normalizedR = r / coneRadius;
        const yOffset = bulgeFactor * (1 - normalizedR * normalizedR);
        const finalY = y * (1 + yOffset);
        
        positions.push(x, finalY, z);
        
        const relativePos = y / coneHeight;
        const finalColor = new THREE.Color();
        const wakeEnd = 0.3; 
        const coreEnd = 0.9; 
        
        if (relativePos < wakeEnd) { 
            const t = relativePos / wakeEnd;
            finalColor.copy(wakeColor).lerp(coreColor, t);
        } else if (relativePos < coreEnd) { 
            finalColor.copy(coreColor);
        } else { 
            const t = (relativePos - coreEnd) / (1.0 - coreEnd);
            finalColor.copy(coreColor).lerp(shockColor, t);
        }
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      }
      
      const particlesGeometry = new THREE.BufferGeometry();
      particlesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      particlesGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      
      const cmeMaterial = new THREE.PointsMaterial({
          size: getCmeParticleSize(cme.speed, SCENE_SCALE),
          sizeAttenuation: true,
          map: particleTexture,
          transparent: true,
          opacity: getCmeOpacity(cme.speed),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          vertexColors: true,
      });
      
      const cmeParticleSystem = new THREE.Points(particlesGeometry, cmeMaterial);
      cmeParticleSystem.userData = cme;

      const direction = new THREE.Vector3();
      direction.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cme.latitude), THREE.MathUtils.degToRad(cme.longitude));
      
      cmeParticleSystem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      
      cmeGroupRef.current.add(cmeParticleSystem);
    });

  }, [cmeData, THREE, getClockElapsedTime]);


  useEffect(() => {
    if (!cmeGroupRef.current) return;
    cmeGroupRef.current.children.forEach((cmeMesh: any) => {
      const cme: ProcessedCME = cmeMesh.userData;
      if (currentlyModeledCMEId) {
        cmeMesh.visible = cme.id === currentlyModeledCMEId;
        if(cme.id === currentlyModeledCMEId && cmeMesh.userData){
            cmeMesh.userData.simulationStartTime = getClockElapsedTime(); 
        }
      } else {
        cmeMesh.visible = true; 
      }
    });
    if (predictionLineRef.current) {
        const cme = cmeData.find(c => c.id === currentlyModeledCMEId);
        predictionLineRef.current.visible = !!(cme && cme.isEarthDirected && currentlyModeledCMEId);
    }

  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime, gsap, THREE]);

  const moveCamera = useCallback((view: ViewMode, focus: FocusTarget | null) => {
    if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return; 

    const targetPosition = new THREE.Vector3(0, 0, 0); 
    if (focus === FocusTarget.EARTH && celestialBodiesRef.current.EARTH) {
      celestialBodiesRef.current.EARTH.mesh.getWorldPosition(targetPosition);
    }
    // If focus is SUN or null, the target position defaults to (0,0,0) which is correct.

    let camPos = new THREE.Vector3();
    if (view === ViewMode.TOP) {
      camPos.set(targetPosition.x, targetPosition.y + SCENE_SCALE * 4, targetPosition.z + 0.01); 
    } else { // Side View
      camPos.set(targetPosition.x + SCENE_SCALE * 1.8, targetPosition.y + SCENE_SCALE * 0.3 , targetPosition.z); 
    }
    
    gsap.to(cameraRef.current.position, {
      duration: 1.2,
      x: camPos.x,
      y: camPos.y,
      z: camPos.z,
      ease: "power2.inOut"
    });
    gsap.to(controlsRef.current.target, {
      duration: 1.2,
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z,
      ease: "power2.inOut",
      onUpdate: () => controlsRef.current.update() 
    });
  }, [gsap, THREE]);

  // Effect to move camera based on UI selections
  useEffect(() => {
    moveCamera(activeView, focusTarget);
  }, [activeView, focusTarget, dataVersion, moveCamera]); 

  // Expose resetView function to parent component
  React.useImperativeHandle(ref, () => ({
    resetView: () => {
      moveCamera(ViewMode.TOP, FocusTarget.EARTH);
    }
  }), [moveCamera]);


  // Effect to manage interaction mode (controls enabling/disabling and cursor style)
  useEffect(() => {
    if (controlsRef.current && rendererRef.current?.domElement) {
      const isMoveMode = interactionMode === InteractionMode.MOVE;
      controlsRef.current.enabled = isMoveMode;
      rendererRef.current.domElement.style.cursor = isMoveMode ? 'move' : 'pointer';
    }
  }, [interactionMode]);

  useEffect(() => {
    if (!THREE || !sceneRef.current || !celestialBodiesRef.current.EARTH) return; 
    if (predictionLineRef.current) {
      sceneRef.current.remove(predictionLineRef.current);
      predictionLineRef.current.geometry.dispose();
      predictionLineRef.current.material.dispose();
      predictionLineRef.current = null; 
    }

    const cme = cmeData.find(c => c.id === currentlyModeledCMEId);
    if (cme && cme.isEarthDirected && celestialBodiesRef.current.EARTH) {
      const earthPos = new THREE.Vector3();
      celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthPos);
      
      const points = [new THREE.Vector3(0, 0, 0), earthPos]; 
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({ 
        color: 0xffff00, 
        transparent: true, 
        opacity: 0.8,
        dashSize: 0.05 * SCENE_SCALE, 
        gapSize: 0.02 * SCENE_SCALE 
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances(); 
      line.visible = !!currentlyModeledCMEId; 
      sceneRef.current.add(line);
      predictionLineRef.current = line;
    }
  }, [currentlyModeledCMEId, cmeData, THREE, SCENE_SCALE]); 

  // Toggle visibility for extra planets
  useEffect(() => {
    if (!celestialBodiesRef.current || !orbitsRef.current) return;
    const extraPlanets = ['MERCURY', 'VENUS', 'MARS'];
    extraPlanets.forEach(name => {
      const body = celestialBodiesRef.current[name];
      const orbit = orbitsRef.current[name];
      if (body) body.mesh.visible = showExtraPlanets;
      if (orbit) orbit.visible = showExtraPlanets;
    });
  }, [showExtraPlanets]);

  // Toggle visibility for Moon and L1
  useEffect(() => {
    if (!celestialBodiesRef.current) return;
    const moon = celestialBodiesRef.current['MOON'];
    const l1 = celestialBodiesRef.current['L1'];
    
    if (moon) moon.mesh.visible = showMoonL1;
    if (l1) l1.mesh.visible = showMoonL1;

    // Also toggle moon's orbit
    const earthMesh = celestialBodiesRef.current['EARTH']?.mesh;
    if (earthMesh) {
      const moonOrbit = earthMesh.children.find((c:any) => c.name === 'moon-orbit');
      if (moonOrbit) moonOrbit.visible = showMoonL1;
    }
  }, [showMoonL1]);


  const checkImpacts = useCallback(() => {
    if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;

    let maxImpactSpeed = 0;
    const earthRadiusVisual = PLANET_DATA_MAP.EARTH.size;
    const earthOrbitRadius = PLANET_DATA_MAP.EARTH.radius;

    const earthWorldPos = new THREE.Vector3();
    celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthWorldPos);

    cmeGroupRef.current.children.forEach((cmeObject: any) => {
        if (!cmeObject.visible || !cmeObject.userData) return;
        const cme: ProcessedCME = cmeObject.userData;
        
        const cmeTipPosition = cmeObject.position.length();
        const cmeScaledLength = cmeObject.scale.y;
        const distTraveled = cmeTipPosition + cmeScaledLength;

        if (distTraveled >= earthOrbitRadius - (earthRadiusVisual * 10) && distTraveled <= earthOrbitRadius + (earthRadiusVisual * 10)) {
            const cmeDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion).normalize();
            const earthDirection = earthWorldPos.clone().normalize();
            const angleBetween = cmeDirection.angleTo(earthDirection);
            const cmeHalfAngleRad = THREE.MathUtils.degToRad(cme.halfAngle);
            
            if (angleBetween <= cmeHalfAngleRad) {
                maxImpactSpeed = Math.max(maxImpactSpeed, cme.speed);
            }
        }
    });

    return maxImpactSpeed;
  }, [THREE]);

  const updateImpactEffects = useCallback((maxImpactSpeed: number, elapsedTime: number) => {
    if (!orbitsRef.current.EARTH || !celestialBodiesRef.current.EARTH) return;
    
    // Update orbit color
    orbitsRef.current.EARTH.material.color.set(maxImpactSpeed > 0 ? 0xff4444 : 0x404040);
    orbitsRef.current.EARTH.material.opacity = maxImpactSpeed > 0 ? 0.9 : 0.4;

    const earthMesh = celestialBodiesRef.current.EARTH.mesh;
    const atmosphereMesh = earthMesh.children.find(c => c.name === 'atmosphere') as any;
    const auroraMesh = earthMesh.children.find(c => c.name === 'aurora') as any;
    
    if (maxImpactSpeed > 0) {
      // Trigger simple atmosphere ripple
      if (atmosphereMesh?.material.uniforms.uImpactTime) {
        const lastImpact = atmosphereMesh.material.uniforms.uImpactTime.value;
        if (elapsedTime - lastImpact > 3.0) { // Prevent constant re-triggering
          atmosphereMesh.material.uniforms.uImpactTime.value = elapsedTime;
        }
      }
      // Update aurora with new speed and time
      if (auroraMesh?.material.uniforms) {
        auroraMesh.material.uniforms.uCmeSpeed.value = maxImpactSpeed;
        auroraMesh.material.uniforms.uImpactTime.value = elapsedTime;
      }
    }
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default React.forwardRef(SimulationCanvas);