import { useRef, useState, useEffect } from 'react';
import { Database, Layers, Brain, Eye, Loader2 } from 'lucide-react';
import OpenSeadragon from 'openseadragon';


interface Dataset {
  id: number;
  name: string;
  features_file: string;
  pca_file: string;
  superpixel_size: number;
  slide_count: number;
}

interface Slide {
  id: number;
  name: string;
  patient: string;
  x_size: number;
  y_size: number;
  pyramid_path: string;
  scale: number;
}

interface Nucleus {
  nucleus_id: number;
  index: number;
  x: number;
  y: number;
  bbox_x0: number;
  bbox_y0: number;
  bbox_x1: number;
  bbox_y1: number;
}

interface NucleiResult {
  success: boolean;
  nuclei: Nucleus[];
  nucleus_count: number;
  error?: string;
}

interface SelectedSample {
  index : number;
  x: number;
  y: number;
  label: 'positive' | 'negative';
}

interface ModelInfo {
  slide_name: string;
  filename: string;
  size_mb: number;
  created: string;
  is_valid: boolean;
}

interface Prediction {
  index: number;
  nucleus_id: number;
  x: number;
  y: number;
  prediction: string;
  probability: number;
}

const HistomicsTrainingAnalysis = () => {
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [segmentationComplete, setSegmentationComplete] = useState(false);

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [selectedSlide, setSelectedSlide] = useState<Slide | null>(null);

  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  
  const [trainedModelName, setTrainedModelName] = useState<string | null>(null);
  
  const [selectedModelForPrediction, setSelectedModelForPrediction] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const [viewer, setViewer] = useState<OpenSeadragon.Viewer | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [forceShowDatasetDropdown, setForceShowDatasetDropdown] = useState(false);

  const [showSegmentation, _setShowSegmentation] = useState(true);
  const [segmentCount, setSegmentCount] = useState(0);
  const overlayRef = useRef<any>(null);
  const [nucleiData, setNucleiData] = useState<Nucleus[]>([]);

  const loadingPredictionsRef = useRef<boolean>(false);
  //  Sample selection state
  const [selectedSamples, setSelectedSamples] = useState<SelectedSample[]>([]);
  const [currentLabel, setCurrentLabel] = useState<'positive' | 'negative'>('positive');

  //  Training state
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);

  //  Prediction state
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);

  const [availableModels, setAvailableModels] = useState<Array<{
	slide_name: string;
  	filename: string;
  	size_mb: number;
  	created: string;
  	is_valid: boolean;
	}>>([]);
  const [showModelManager, setShowModelManager] = useState(false);


  const predictionOverlayRef = useRef<any>(null);
  const currentLabelRef = useRef<'positive' | 'negative'>('positive'); 
  const visibleNucleiSetRef = useRef<Set<number>>(new Set());
  
  // Iterative learning state
  const [iterationCount, setIterationCount] = useState(0);
  const [allTrainingSamples, setAllTrainingSamples] = useState<SelectedSample[]>([]); 

  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [heatmapBinSize, setHeatmapBinSize] = useState<number>(100);
  const [heatmapOverlayRef, setHeatmapOverlayRef] = useState<HTMLCanvasElement | null>(null);
  const ZOOM_THRESHOLD = 2.5;
  
  const positiveCount = selectedSamples.filter(s => s.label === 'positive').length;
  const negativeCount = selectedSamples.filter(s => s.label === 'negative').length;
  const canTrain = positiveCount === 4 && negativeCount === 4;

  const API_BASE_URL = `/api`;
  
  useEffect(() => {
    if (viewer && segmentationComplete && nucleiData.length > 0) { 
      const timeoutId = window.setTimeout(() => {
      drawNucleiOverlay();
    }, 50); // Batch rapid clicks
    
    return () => window.clearTimeout(timeoutId);
  }
}, [selectedSamples]);

useEffect(() => {
  currentLabelRef.current = currentLabel;
}, [currentLabel]);
 
useEffect(() => {
  console.log('=== STATE UPDATE ===');
  console.log('Total samples:', selectedSamples.length);
  console.log('Positive:', positiveCount);
  console.log('Negative:', negativeCount);
  console.log('Current label:', currentLabel);
  console.log('Samples:', selectedSamples.map(s => `${s.index}(${s.label})`));
  console.log('==================');
}, [selectedSamples, currentLabel]);

  // Auto-switch between heatmap and predictions based on zoom
  
 useEffect(() => {
  if (!viewer || predictions.length === 0) return;

  const handleZoom = () => {
    const zoom = viewer.viewport.getZoom();
  
    if (zoom < ZOOM_THRESHOLD) {
      // ZOOMED OUT - Show heatmap
      if (!showHeatmap) {
        setShowPredictions(false);
        setShowHeatmap(true);
        console.log('[AUTO-SWITCH] Zoom out → Showing heatmap');
      }
    } else {
      // ZOOMED IN - Show predictions
      if (!showPredictions) {
        setShowPredictions(true);
        setShowHeatmap(false);
        console.log('[AUTO-SWITCH] Zoom in → Showing predictions');
      }
    }
  };

  viewer.addHandler('zoom', handleZoom);
  handleZoom(); // Initial check

  return () => {
    viewer.removeHandler('zoom', handleZoom);
  };
}, [viewer, predictions, showHeatmap, showPredictions]);
 
  // Redraw heatmap when settings change
  useEffect(() => {
    if (showHeatmap && predictions.length > 0) {
      drawHeatmapOverlay();
    } else if (!showHeatmap && heatmapOverlayRef) {
      viewer?.removeOverlay(heatmapOverlayRef);
      setHeatmapOverlayRef(null);
    }
  }, [showHeatmap, predictions, heatmapBinSize, viewer]);

  // Auto-fetch available models when segmentation completes
useEffect(() => {
  if (segmentationComplete) {
    fetchAvailableModels();
  }
}, [segmentationComplete]);

// Also fetch models on component mount
useEffect(() => {
  fetchAvailableModels();
}, []);


  // Auto-select model when slide changes
useEffect(() => {
  if (selectedSlide && trainedModelName === selectedSlide.name) {
    setSelectedModelForPrediction(selectedSlide.name);
  } else {
    setSelectedModelForPrediction(null);
  }
}, [selectedSlide, trainedModelName]);

  // Ensure only one view is active
  useEffect(() => {
   if (showHeatmap && showPredictions) {
     setShowPredictions(false);
    }
  }, [showHeatmap]);
 
 useEffect(() => {
  if (!viewer || !segmentationComplete || nucleiData.length === 0) return;

  let timeoutId: number;

  const updateOverlay = () => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      if (showPredictions && predictions.length > 0) {
        // Clear nuclei overlay if it exists
        if (overlayRef.current) {
          viewer.removeOverlay(overlayRef.current);
          overlayRef.current = null;
        }
        // Clear heatmap when showing predictions
        if (heatmapOverlayRef) {
          viewer.removeOverlay(heatmapOverlayRef);
          setHeatmapOverlayRef(null);
        }
        drawPredictionsOverlay();
      } else if (showSegmentation && !showPredictions && !showHeatmap) {  
        // Clear prediction overlay if it exists
        if (predictionOverlayRef.current) {
          viewer.removeOverlay(predictionOverlayRef.current);
          predictionOverlayRef.current = null;
        }
        //  Clear heatmap when showing nuclei
        if (heatmapOverlayRef) {
          viewer.removeOverlay(heatmapOverlayRef);
          setHeatmapOverlayRef(null);
        }
        drawNucleiOverlay();
      }
    }, 200);
  };
 
  viewer.addHandler('zoom', updateOverlay);
  viewer.addHandler('pan', updateOverlay);

  updateOverlay();

  return () => {
    window.clearTimeout(timeoutId);
    viewer.removeHandler('zoom', updateOverlay);
    viewer.removeHandler('pan', updateOverlay);
  };
  }, [viewer, segmentationComplete, nucleiData, showSegmentation, selectedSamples, predictions, showPredictions, allTrainingSamples]); 

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    if (datasets.length === 1 && !selectedDataset && !forceShowDatasetDropdown) {
      setSelectedDataset(datasets[0]);
      console.log('Auto-selected single dataset:', datasets[0]);
    }
  }, [datasets, selectedDataset, forceShowDatasetDropdown]);

  useEffect(() => {
    if (selectedDataset) {
      fetchSlides(selectedDataset.id);
    } else {
      setSlides([]);
      setSelectedSlide(null);
    }
  }, [selectedDataset]);

useEffect(() => {
  if (!viewerRef.current || !selectedSlide) {
    return;
  }

  if (viewer) {
    viewer.destroy();
    setViewer(null);
  }

  const osdViewer = OpenSeadragon({
    element: viewerRef.current,
    prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.1/images/',
    showNavigationControl: true,
    showZoomControl: true,
    showHomeControl: true,
    showFullPageControl: true,
    showSequenceControl: false,
    animationTime: 0.3,
    blendTime: 0.1,
    springStiffness: 10.0,
    constrainDuringPan: false,
    maxZoomPixelRatio: 32,
    minZoomImageRatio: 0.9,
    visibilityRatio: 0.5,
    zoomPerScroll: 1.8,
    zoomPerClick: 1.4,
    useCanvas: true,
    smoothTileEdgesMinZoom: 0.8,
    wrapHorizontal: false,
    wrapVertical: false,
    timeout: 120000,
    loadTilesWithAjax: true,
    crossOriginPolicy: false,
    ajaxWithCredentials: false,
    imageLoaderLimit: 4,
    immediateRender: false,
    preserveImageSizeOnResize: true,
    preserveViewport: true,
    gestureSettingsMouse: {
      scrollToZoom: true,
      clickToZoom: false,
      dblClickToZoom: false,
      pinchToZoom: false,
      flickEnabled: false,
      flickMinSpeed: 120,
      flickMomentum: 0.25
    },
    gestureSettingsTouch: {
      scrollToZoom: false,
      clickToZoom: false,
      dblClickToZoom: true,
      pinchToZoom: true,
      flickEnabled: true,
      flickMinSpeed: 120,
      flickMomentum: 0.25
    },
    debugMode: false,
    mouseNavEnabled: true,
    controlsFadeDelay: 2000,
    controlsFadeLength: 1500
  });

  setViewer(osdViewer);

 const handleClick = (event: any) => {
  if (!osdViewer || !segmentationComplete || isTraining) {
    console.log('Click blocked:', { 
      hasViewer: !!osdViewer, 
      segmentationComplete, 
      isTraining 
    });
    return;
  }

  const viewportPoint = osdViewer.viewport.pointFromPixel(event.position);
  const imagePoint = osdViewer.viewport.viewportToImageCoordinates(viewportPoint);

  console.log('Click detected with currentLabel:', currentLabelRef.current);

  let foundNucleus: Nucleus | null = null;
  let minDistance = Infinity;
  const CLICK_RADIUS = 50;

  for (const nucleus of nucleiData) {
   if (!visibleNucleiSetRef.current.has(nucleus.index)) {
      continue;
    }
   const insideBBox = 
      imagePoint.x >= nucleus.bbox_x0 &&
      imagePoint.x <= nucleus.bbox_x1 &&
      imagePoint.y >= nucleus.bbox_y0 &&
      imagePoint.y <= nucleus.bbox_y1;

    const distanceToCentroid = Math.sqrt(
      Math.pow(imagePoint.x - nucleus.x, 2) +
      Math.pow(imagePoint.y - nucleus.y, 2)
    );

    const nearCentroid = distanceToCentroid <= CLICK_RADIUS;

    if (insideBBox || nearCentroid) {
      if (distanceToCentroid < minDistance) {
        foundNucleus = nucleus;
        minDistance = distanceToCentroid;
        console.log('Found nucleus:', nucleus.nucleus_id, 
                    'bbox:', insideBBox, 
                    'centroid:', nearCentroid, 
                    'distance:', distanceToCentroid.toFixed(2));
      }
    }
  }

  if (foundNucleus) {
    console.log('Selected nucleus:', foundNucleus.nucleus_id, 'distance:', minDistance.toFixed(2));
    handleNucleusSelect(foundNucleus);
  } else {
    console.log('No nucleus found at click position');
  }
};

  osdViewer.addHandler('canvas-click', handleClick);
  osdViewer.addHandler('tile-load-failed', function () {
    console.warn('Tile load failed');
  });

  if (selectedSlide.pyramid_path) {
    loadSlideImage(selectedSlide.pyramid_path, osdViewer);
  }

  return () => {
    try {
      osdViewer.removeHandler('canvas-click', handleClick);
      osdViewer.destroy();
    } catch (error) {
      console.log('Viewer cleanup completed');
    }
  };
}, [viewerRef.current, selectedSlide, segmentationComplete, isTraining, nucleiData ]);


 useEffect(() => {
  if (selectedSlide?.id) {
    // Clear nuclei overlay
    clearNucleiOverlay();
    
    // CLEAR PREDICTION OVERLAY
    if (viewer && predictionOverlayRef.current) {
      viewer.removeOverlay(predictionOverlayRef.current);
      predictionOverlayRef.current = null;
    }
    
    // CLEAR HEATMAP OVERLAY
    if (viewer && heatmapOverlayRef) {
      viewer.removeOverlay(heatmapOverlayRef);
      setHeatmapOverlayRef(null);
    }
    
    // RESET ALL STATE
    setSegmentationComplete(false);
    setNucleiData([]);
    setSelectedSamples([]);
    setPredictions([]);  // Clear predictions
    setShowPredictions(false);  // Hide predictions
    setShowHeatmap(false);  // Hide heatmap
    setIterationCount(0);  // Reset iteration
    setAllTrainingSamples([]);  // Clear training history
    setTrainingProgress(0);
    setIsTraining(false);
  }  
}, [selectedSlide?.id]);  // Add viewer to dependencies

  const fetchDatasets = async () => {
    try {
      setLoadingDatasets(true);
      const response = await fetch(`${API_BASE_URL}/datasets`);
      const data = await response.json();

      if (data.success) {
        setDatasets(data.datasets);
        console.log('Datasets loaded:', data.datasets);
      } else {
        console.error('Failed to fetch datasets:', data.error);
        alert('Failed to load datasets. Please check the API connection.');
      }
    } catch (error) {
      console.error('Error fetching datasets:', error);
      alert('Error connecting to API. Please ensure the backend is running.');
    } finally {
      setLoadingDatasets(false);
    }
  };

  const fetchSlides = async (datasetId: number) => {
    try {
      setLoadingSlides(true);
      const response = await fetch(`${API_BASE_URL}/datasets/${datasetId}/slides`);
      const data = await response.json();

      if (data.success) {
        setSlides(data.slides);
        console.log('Slides loaded:', data.slides);
      } else {
        console.error('Failed to fetch slides:', data.error);
        alert('Failed to load slides for the selected dataset.');
      }
    } catch (error) {
      console.error('Error fetching slides:', error);
      alert('Error loading slides. Please try again.');
    } finally {
      setLoadingSlides(false);
    }
  };

  const loadSlideImage = async (imagePath: string, targetViewer: OpenSeadragon.Viewer) => {
    if (!targetViewer || !imagePath) {
      setImageError('Viewer or image path missing');
      setImageLoading(false);
      return;
    }

    setImageLoading(true);
    setImageError(null);

    try {
      targetViewer.world.removeAll();
      const iipBaseUrl = `${window.location.origin}/iipsrv/iipsrv.fcgi`;

      console.log('Loading image with IIP DeepZoom format...');

      const deepZoomUrl = `${iipBaseUrl}?DeepZoom=${encodeURIComponent(imagePath)}.dzi`;

      console.log('DeepZoom URL:', deepZoomUrl);

      const openHandler = () => {
        console.log('DeepZoom image loaded successfully');
        setImageLoading(false);


        targetViewer.removeHandler('open', openHandler);
        targetViewer.removeHandler('open-failed', failHandler);
      };

      const failHandler = () => {
        console.log('DeepZoom failed, trying IIIF format...');
        targetViewer.removeHandler('open', openHandler);
        targetViewer.removeHandler('open-failed', failHandler);
        tryIIIFFallback(imagePath, targetViewer);
      };

      targetViewer.addHandler('open', openHandler);
      targetViewer.addHandler('open-failed', failHandler);

      targetViewer.open(deepZoomUrl);

    } catch (error) {
      console.error('Error in DeepZoom loading:', error);
      tryIIIFFallback(imagePath, targetViewer);
    }
  };

  const tryIIIFFallback = (imagePath: string, targetViewer: OpenSeadragon.Viewer) => {
    const iipBaseUrl = `${window.location.origin}/iipsrv/iipsrv.fcgi`;

    console.log('Using IIIF format for seamless viewing...');

    const iiifUrl = `${iipBaseUrl}?IIIF=${encodeURIComponent(imagePath)}/info.json`;

    console.log('IIIF URL:', iiifUrl);

    const openHandler = () => {
      console.log('IIIF image loaded successfully - seamless viewing enabled');
      setImageLoading(false);
      targetViewer.removeHandler('open', openHandler);
      targetViewer.removeHandler('open-failed', finalFailHandler);
    };

    const finalFailHandler = () => {
      console.log('IIIF also failed, using simple image...');
      targetViewer.removeHandler('open', openHandler);
      targetViewer.removeHandler('open-failed', finalFailHandler);

      const width = selectedSlide?.x_size || 10000;
      const height = selectedSlide?.y_size || 10000;
      trySimpleImageFallback(imagePath, targetViewer, width, height);
    };

    targetViewer.addHandler('open', openHandler);
    targetViewer.addHandler('open-failed', finalFailHandler);

    targetViewer.open(iiifUrl);
  };

  const trySimpleImageFallback = (imagePath: string, targetViewer: OpenSeadragon.Viewer, width: number, height: number) => {
    const iipBaseUrl = `${window.location.origin}/iipsrv/iipsrv.fcgi`;

    console.log('Using simple image fallback...');

    const simpleSource = {
      type: 'image',
      url: `${iipBaseUrl}?FIF=${encodeURIComponent(imagePath)}&WID=2048&CVT=jpeg`,
      width: width,
      height: height,
      crossOriginPolicy: false,
      ajaxWithCredentials: false
    };

    console.log('Simple image source:', simpleSource);

    targetViewer.addOnceHandler('open', () => {
      console.log('Simple image loaded successfully');
      setImageLoading(false);

    });



    targetViewer.addOnceHandler('open-failed', (event) => {
      console.log('All image loading methods failed:', event);
      setImageError('Unable to load image with any available method. Please check the image path and IIP server configuration.');
      setImageLoading(false);
    });

    targetViewer.open(simpleSource);
  };

  const handleDatasetSelect = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    setSelectedSlide(null);
    setForceShowDatasetDropdown(false);
    setSegmentationComplete(false);
    setImageError(null);
    console.log('Dataset selected:', dataset);
  };

  const handleSlideSelect = (slide: Slide) => {
    console.log('Slide selected:', slide.name);
    console.log('Pyramid path:', slide.pyramid_path);

    setSelectedSlide(slide);
    setSegmentationComplete(false);
    setImageError(null);
  };

  const handleSegmentation = async () => {
    if (!selectedSlide || !viewer) {
      alert('Please select a slide first');
      return;
    }

    console.log('Loading nuclei boundaries for:', selectedSlide.name);
    setIsSegmenting(true);
    setSegmentationComplete(false);
    setImageError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/nuclei/${selectedSlide.name}`);
      const result: NucleiResult = await response.json();

      if (result.success) {
        console.log(`Loaded ${result.nucleus_count} nuclei`);
   
         const nucleiWithIndex = result.nuclei.map((nucleus: any, index: number) => ({
        ...nucleus,
        index: index  //  Add array position
      }));

        setSegmentCount(result.nucleus_count);
        setSegmentationComplete(true);
        setNucleiData(nucleiWithIndex);
	
	drawNucleiOverlay();
        await checkForExistingModel();

      } else {
        setImageError(result.error || 'Failed to load nuclei');
        console.error('Nuclei loading failed:', result.error);
      }
    } catch (error) {
      console.error('Error loading nuclei:', error);
      setImageError('Network error loading nuclei');
    } finally {
      setIsSegmenting(false);
    }
  };

const checkForExistingModel = async () => {
  if (!selectedSlide) return;
  
  try {
    const response = await fetch(`${API_BASE_URL}/ml/models/list`);
    const result = await response.json();
    
    if (result.success) {
      const models: ModelInfo[] = result.models;
      
      const modelForThisSlide = models.find(
        m => m.slide_name === selectedSlide.name && m.is_valid
      );
      
      if (modelForThisSlide) {
        setTrainedModelName(selectedSlide.name);
        console.log(`✓ Model found for ${selectedSlide.name}`);
      } else {
        setTrainedModelName(null);
        console.log(`✗ No model found for ${selectedSlide.name}`);
      }
    }
  } catch (error) {
    console.error('Error checking for model:', error);
  }
};


//  Add or remove nucleus from selection
const handleNucleusSelect = (nucleus: Nucleus) => {
  const labelToUse = currentLabelRef.current;
  
  
  setSelectedSamples(prev => {
    const existingIndex = prev.findIndex(s => s.index === nucleus.index);

    if (existingIndex >= 0) {
      console.log('Deselecting nucleus:', nucleus.nucleus_id);
      return prev.filter((_, i) => i !== existingIndex);
    }

    const currentLabelCount = prev.filter(s => s.label === labelToUse).length;

    if (currentLabelCount >= 4) {
      alert(`Already selected 4 ${labelToUse} samples. Please deselect one first or switch to ${labelToUse === 'positive' ? 'negative' : 'positive'}.`);
      return prev;
    }

    const newSample: SelectedSample = {
      index: nucleus.index,
      x: nucleus.x,
      y: nucleus.y,
      label: labelToUse
    };

    return [...prev, newSample];
  });
};

const drawNucleiOverlay = () => {
  if (!viewer || !nucleiData.length) return;

  if (overlayRef.current) {
    viewer.removeOverlay(overlayRef.current);
    overlayRef.current = null;
  }

  if (!showSegmentation || showPredictions || showHeatmap) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('pointer-events', 'none');
  svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';

  const sampledNuclei = nucleiData.filter((_, i) => i % 10 === 0);

  // Track which nuclei are actually being drawn
  const visibleNucleiIds = new Set(sampledNuclei.map(n => n.index));
  selectedSamples.forEach(s => visibleNucleiIds.add(s.index));
  visibleNucleiSetRef.current = visibleNucleiIds;
  
  console.log(`Drawing ${sampledNuclei.length} nuclei, ${visibleNucleiIds.size} total clickable`);

  sampledNuclei.forEach(nucleus => {
    const selected = selectedSamples.find(s => s.index === nucleus.index);

    const topLeft = viewer.viewport.imageToViewportCoordinates(nucleus.bbox_x0, nucleus.bbox_y0);
    const bottomRight = viewer.viewport.imageToViewportCoordinates(nucleus.bbox_x1, nucleus.bbox_y1);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', topLeft.x.toString());
    rect.setAttribute('y', topLeft.y.toString());
    rect.setAttribute('width', (bottomRight.x - topLeft.x).toString());
    rect.setAttribute('height', (bottomRight.y - topLeft.y).toString());
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', selected ? (selected.label === 'positive' ? '#00FF00' : '#FFFF00') : '#00FF00');
    rect.setAttribute('stroke-width', selected ? '0.0004' : '0.0002');
    rect.setAttribute('opacity', selected ? '1' : '0.7');
    rect.setAttribute('pointer-events', 'none');
    svg.appendChild(rect);

    const center = viewer.viewport.imageToViewportCoordinates(nucleus.x, nucleus.y);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', center.x.toString());
    dot.setAttribute('cy', center.y.toString());
    
    if (selected) {
      dot.setAttribute('r', '0.0005');
      dot.setAttribute('fill', '#FFA500'); // orange  center
      dot.setAttribute('stroke', selected.label === 'positive' ? '#00FF00' : '#FF0000');
      dot.setAttribute('stroke-width', '0.00005');
      dot.setAttribute('opacity', '1');
    } else {
      // Unselected: Keep original yellow dot
      dot.setAttribute('r', '0.00012');
      dot.setAttribute('fill', '#FFFF00');
      dot.setAttribute('opacity', '0.7');
    }
    
    dot.setAttribute('pointer-events', 'none');
    svg.appendChild(dot);
  });

  viewer.addOverlay(svg as unknown as HTMLElement, new OpenSeadragon.Rect(0, 0, 1, 1));
  overlayRef.current = svg;
};

// Draw prediction overlay
const drawPredictionsOverlay = () => {
  if (!viewer || !predictions.length) return;

  // Clear any existing overlays first
  if (predictionOverlayRef.current) {
    viewer.removeOverlay(predictionOverlayRef.current);
    predictionOverlayRef.current = null;
  }
  
  // Ensure nuclei overlay is cleared
  if (overlayRef.current) {
    viewer.removeOverlay(overlayRef.current);
    overlayRef.current = null;
  }
  
  if (heatmapOverlayRef) {
    viewer.removeOverlay(heatmapOverlayRef);
    setHeatmapOverlayRef(null);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';

// Create Set of selected indices for fast lookup
  const selectedIndices = new Set(selectedSamples.map(s => s.index));

// Sample 10% of predictions for performance (but NOT selected samples)
  const sampledPredictions = predictions.filter((_, i) => i % 10 === 0 || selectedIndices.has(predictions[i].index));

  console.log(`Drawing ${sampledPredictions.length} predictions (including ${selectedSamples.length} selected)`);

// FIRST: Draw prediction dots (non-selected)
  sampledPredictions.forEach(pred => {
    if (selectedIndices.has(pred.index)) return; // Skip selected, draw them later
  
    const center = viewer.viewport.imageToViewportCoordinates(pred.x, pred.y);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', center.x.toString());
    dot.setAttribute('cy', center.y.toString());
    dot.setAttribute('r', '0.0002');
    dot.setAttribute('fill', pred.prediction === 'positive' ? '#FF00FF' : '#00FFFF');
    dot.setAttribute('opacity', (pred.probability * 0.8).toString());
    svg.appendChild(dot);
  });

// SECOND: Draw ALL selected training samples on top (always visible)
  selectedSamples.forEach(sample => {
    const center = viewer.viewport.imageToViewportCoordinates(sample.x, sample.y);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', center.x.toString());
    dot.setAttribute('cy', center.y.toString());
    dot.setAttribute('r', '0.0005');
    dot.setAttribute('fill', '#FFA500'); // orange center
    dot.setAttribute('stroke', sample.label === 'positive' ? '#00FF00' : '#FF0000');
    dot.setAttribute('stroke-width', '0.00005');
    dot.setAttribute('opacity', '1');
    svg.appendChild(dot);
  });
  viewer.addOverlay(svg as unknown as HTMLElement, new OpenSeadragon.Rect(0, 0, 1, 1));
  predictionOverlayRef.current = svg;
};  


//  Submit training job
 
const handleTraining = async () => {
  // Capture samples in local variable IMMEDIATELY
  const samplesToSubmit = [...selectedSamples];
  
  console.log('=== TRAINING START ===');
  console.log('Captured samples:', samplesToSubmit.length);
  console.log('Samples:', samplesToSubmit);
  console.log('====================');
  
  // Validate using the captured variable
  if (samplesToSubmit.length === 0) {
    console.log('BLOCKED: No samples captured');
    alert('Please select 8 samples before training');
    return;
  }
  
  if (!selectedDataset || !selectedSlide) {
    alert('Please select a dataset and slide');
    return;
  }

  if (samplesToSubmit.length !== 8) {
    alert('Please select exactly 8 samples (4 positive + 4 negative) before training');
    return;
  }

  // Validate 4+4 split
  const posCount = samplesToSubmit.filter(s => s.label === 'positive').length;
  const negCount = samplesToSubmit.filter(s => s.label === 'negative').length;
  
  if (posCount !== 4 || negCount !== 4) {
    alert(`Please select exactly 4 positive and 4 negative samples. Currently: ${posCount} positive, ${negCount} negative`);
    return;
  }

  // Check for duplicates on iterations 2+
  if (iterationCount > 0 && allTrainingSamples.length > 0) {
    const isDuplicate = samplesToSubmit.every(sample => 
      allTrainingSamples.some(existing => existing.index === sample.index)
    );
    
    if (isDuplicate) {
      alert('These samples are already in the training set. Please select NEW samples.');
      return;
    }
  }
  
  // Cancel any existing polling
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
  }
  
  // Reset flags
  loadingPredictionsRef.current = false;

  // Accumulate training samples using the captured variable
  const newAllSamples = [...allTrainingSamples, ...samplesToSubmit];
  
  console.log('=== ACCUMULATION ===');
  console.log('Previous total:', allTrainingSamples.length);
  console.log('Adding:', samplesToSubmit.length);
  console.log('New total:', newAllSamples.length);
  console.log('===================');
  
  // Update state
  setAllTrainingSamples(newAllSamples);
  
  // Clear selected samples AFTER capturing
  setSelectedSamples([]);
  
  // Increment iteration count
  const newIteration = iterationCount + 1;
  setIterationCount(newIteration);

  setIsTraining(true);
  setTrainingProgress(0);
  setPredictions([]);
  setShowPredictions(false);

  try {
    // Prepare annotations from the local variable
    const annotations = newAllSamples.map(s => ({
      index: s.index,  
      label: s.label
    }));
    
    console.log('=== SENDING TO BACKEND ===');
    console.log('Iteration:', newIteration);
    console.log('Annotations count:', annotations.length);
    console.log('Annotations:', annotations);
    console.log('========================');
    
    const response = await fetch(`${API_BASE_URL}/ml/train-histomics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset_id: selectedDataset.id,
        slide_id: selectedSlide.id,
        annotations: annotations,
        iteration: newIteration
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Training submission failed');
    }

    const newJobId = result.job_id;
    console.log(`Iteration ${newIteration} - Job submitted:`, newJobId);

    pollJobStatus(newJobId);

  } catch (error) {
    console.error('Training error:', error);
    alert(`Error: ${error}`);
    setIsTraining(false);
    
    // Restore samples if submission failed
    setSelectedSamples(samplesToSubmit);
  }
};

  //  Poll job status
const pollJobStatus = async (jobId: string) => {
  // Cancel any existing polling
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
  }
  
  // Create new abort controller
  const abortController = new AbortController();
  abortControllerRef.current = abortController;
  
  console.log(`Starting to poll job: ${jobId}`);
  
  let pollCount = 0;
  const maxPolls = 150;
  
  const poll = async () => {
    // Check if aborted
    if (abortController.signal.aborted) {
      console.log('Polling aborted');
      return;
    }
    
    pollCount++;
    
    if (pollCount > maxPolls) {
      setIsTraining(false);
      alert('Training timeout');
      return;
    }
    
    try {
      const response = await fetch(
        `${API_BASE_URL}/ml/status-histomics/${jobId}`,
        { signal: abortController.signal }
      );
      
      const status = await response.json();
      setTrainingProgress(status.progress || 0);

      if (status.status === 'completed') {
        console.log('Training completed');
        setIsTraining(false);
        setTrainingProgress(100);
        
        // Load predictions
        await loadPredictions(jobId);
        return; // Stop polling
      } else if (status.status === 'error') {
        console.log('Training failed');
        setIsTraining(false);
        alert('Training failed: ' + status.message);
        return; // Stop polling
      }
      
      // Continue polling
      setTimeout(() => poll(), 2000);
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Fetch aborted');
        return;
      }
      console.error('Status check error:', error);
      // Continue polling on error
      setTimeout(() => poll(), 2000);
    }
  };
  
  // Start polling
  poll();
};
//  Load predictions
const loadPredictions = async (jobId: string) => {
  if (loadingPredictionsRef.current) {
    console.log('Already loading predictions, skipping');
    return;
  }
  
  loadingPredictionsRef.current = true;
  
  try {
    console.log(`Loading predictions for job: ${jobId}`);
    
    const response = await fetch(`${API_BASE_URL}/predictions-histomics/${jobId}`);
    const result = await response.json();

    if (result.success) {
      console.log(`Loaded ${result.total_count} predictions`);
      
      setPredictions(result.predictions);
      setShowPredictions(true);
     
      // Store model name for download
      if (selectedSlide) {
        setTrainedModelName(selectedSlide.name);
      } 
      //setSelectedSamples([]); 
      alert(`Prediction Complete! ${result.total_count} predictions (${result.positive_count} positive, ${result.negative_count} negative)`);

      //setTimeout(() => drawPredictionsOverlay(), 100);
    } else {
      console.error('Failed to load predictions:', result.error);
      alert('Failed to load predictions: ' + result.error);
    }
  } catch (error) {
    console.error('Error loading predictions:', error);
    alert('Error loading predictions: ' + error);
  } finally {
    loadingPredictionsRef.current = false;
  }
};


const handleUseExistingModel = async () => {
  if (!selectedDataset || !selectedSlide) {
    alert('Please select a dataset and slide');
    return;
  }

  if (!selectedModelForPrediction) {
    alert('Please select a model to use for predictions');
    return;
  }
  
  if (selectedModelForPrediction !== selectedSlide.name) {
    console.log(`Transfer Learning: Applying model '${selectedModelForPrediction}' on slide '${selectedSlide.name}'`);
  }
  
  setIsTraining(true);
  setTrainingProgress(0);
  setPredictions([]);
  setShowPredictions(false);

  try {
    console.log(`Using model '${selectedModelForPrediction}' for slide '${selectedSlide.name}'`);
    
    const response = await fetch(`${API_BASE_URL}/ml/predict-with-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset_id: selectedDataset.id,
        slide_id: selectedSlide.id,
        model_name: selectedModelForPrediction  // ← NEW: Send selected model name
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Prediction failed');
    }

    console.log('Prediction job submitted:', result.job_id);
    pollJobStatus(result.job_id);

  } catch (error) {
    console.error('Prediction error:', error);
    alert(`Error: ${error}`);
    setIsTraining(false);
  }
};

const fetchAvailableModels = async () => {
  try {
    setLoadingModels(true);
    const response = await fetch(`${API_BASE_URL}/ml/models/list`);
    const result = await response.json();
    
    if (result.success) 
     {
      setAvailableModels(result.models);
	}
  } catch (error) {
    console.error('Error fetching models:', error);
    setAvailableModels([]);
  }finally {
    setLoadingModels(false);
}
};

  const clearNucleiOverlay = () => {
    if (viewer && overlayRef.current) {
      viewer.removeOverlay(overlayRef.current);
      overlayRef.current = null;
    }
    setSegmentCount(0);
   // setSegmentationComplete(false);
   // setShowSegmentation(true);
  };

const analyzeConfidence = (predictions: Prediction[]) => {
  const confidenceBins = {
    'Very High (>0.9)': 0,
    'High (0.7-0.9)': 0,
    'Medium (0.6-0.7)': 0,
    'Low (0.5-0.6)': 0,
    'Very Low (<0.5)': 0
  };

  predictions.forEach(pred => {
    const prob = Math.max(pred.probability, 1 - pred.probability); // Get confidence
    
    if (prob > 0.9) confidenceBins['Very High (>0.9)']++;
    else if (prob >= 0.7) confidenceBins['High (0.7-0.9)']++;
    else if (prob >= 0.6) confidenceBins['Medium (0.6-0.7)']++;
    else if (prob >= 0.5) confidenceBins['Low (0.5-0.6)']++;
    else confidenceBins['Very Low (<0.5)']++;
  });

  console.log('Confidence Distribution:', confidenceBins);
  
  // Calculate percentage
  const total = predictions.length;
  
  Object.entries(confidenceBins).forEach(([key, count]) => {
    const pct = ((count / total) * 100).toFixed(1);
    console.log(`${key}: ${count} (${pct}%)`);
});
};

// Call after loading predictions
analyzeConfidence(predictions);

//Heat Map Functions
// Create spatial bins for heatmap
const createHeatmapBins = (predictions: Prediction[], binSize: number) => {
  const bins = new Map<string, number>();
  
  predictions.forEach(pred => {
    if (pred.prediction !== 'positive') return;
    
    const binX = Math.floor(pred.x / binSize);
    const binY = Math.floor(pred.y / binSize);
    const key = `${binX},${binY}`;
    
    bins.set(key, (bins.get(key) || 0) + 1);
  });
  
  return bins;
};

// Get heatmap color (Blue → Red → Yellow)
const getHeatmapColor = (density: number, maxDensity: number): string => {
  const normalized = Math.min(density / maxDensity, 1.0);
  
  if (normalized < 0.5) {
    const t = normalized * 2;
    const r = Math.floor(255 * t);
    const g = 0;
    const b = Math.floor(255 * (1 - t));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (normalized - 0.5) * 2;
    const r = 255;
    const g = Math.floor(255 * (1 - t));
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  }
};

// Draw heatmap overlay
 
 const drawHeatmapOverlay = () => {
  if (!viewer || !predictions.length || !showHeatmap) return;
  
  if (predictionOverlayRef.current) {
    viewer.removeOverlay(predictionOverlayRef.current);
    predictionOverlayRef.current = null;
  }

  if (heatmapOverlayRef) {
    viewer.removeOverlay(heatmapOverlayRef);
    setHeatmapOverlayRef(null);
  }
  
  console.log('[HEATMAP] Generating heatmap...');
  
  const canvas = document.createElement('canvas');
  canvas.width = 2000;
  canvas.height = 2000;
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;opacity:0.6';
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const bins = createHeatmapBins(predictions, heatmapBinSize);
  
  let maxDensity = 0;
  bins.forEach(count => {
    if (count > maxDensity) maxDensity = count;
  });
  
  console.log(`[HEATMAP] Max density: ${maxDensity} predictions per bin`); // 
  
  bins.forEach((count, key) => {
    const [binX, binY] = key.split(',').map(Number);
    
    const topLeft = viewer.viewport.imageToViewportCoordinates(
      binX * heatmapBinSize,
      binY * heatmapBinSize
    );
    const bottomRight = viewer.viewport.imageToViewportCoordinates(
      (binX + 1) * heatmapBinSize,
      (binY + 1) * heatmapBinSize
    );
    
    const x = topLeft.x * canvas.width;
    const y = topLeft.y * canvas.height;
    const width = (bottomRight.x - topLeft.x) * canvas.width;
    const height = (bottomRight.y - topLeft.y) * canvas.height;
    
    const color = getHeatmapColor(count, maxDensity);
    const opacity = 0.3 + (count / maxDensity) * 0.5;
    
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.fillRect(x, y, width, height);
  });
  
  ctx.globalAlpha = 1.0;
  ctx.filter = 'blur(2px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  
  viewer.addOverlay(canvas as unknown as HTMLElement, new OpenSeadragon.Rect(0, 0, 1, 1));
  setHeatmapOverlayRef(canvas);
  
  if (selectedSamples.length > 0) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';
    
    selectedSamples.forEach(sample => {
      const center = viewer.viewport.imageToViewportCoordinates(sample.x, sample.y);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', center.x.toString());
      dot.setAttribute('cy', center.y.toString());
      dot.setAttribute('r', '0.0005');
      dot.setAttribute('fill', '#FFA500'); 
      dot.setAttribute('stroke', sample.label === 'positive' ? '#00FF00' : '#FF0000'); // 
      dot.setAttribute('stroke-width', '0.00005');
      dot.setAttribute('opacity', '1');
      svg.appendChild(dot);
    });
    
    viewer.addOverlay(svg as unknown as HTMLElement, new OpenSeadragon.Rect(0, 0, 1, 1));
  }
  
  console.log(`[HEATMAP] Rendered ${bins.size} bins with ${selectedSamples.length} selected samples`); // 
}; 

 const handleLabelSwitch = (newLabel: 'positive' | 'negative') => {
  if (!viewer) return;
  
  console.log('Switching label from', currentLabel, 'to', newLabel);
  
  // Save current viewport
  const currentZoom = viewer.viewport.getZoom();
  const currentCenter = viewer.viewport.getCenter();
  
  console.log('Saved zoom:', currentZoom, 'center:', currentCenter);
  
  // Change label
  setCurrentLabel(newLabel);
  
  // Restore viewport immediately
  requestAnimationFrame(() => {
    if (viewer) {
      viewer.viewport.zoomTo(currentZoom, undefined, true);
      viewer.viewport.panTo(currentCenter, true);
      console.log('Restored zoom:', currentZoom);
    }
  });
};
return (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
    <div className="mb-8">
      <h1 className="text-4xl font-bold text-gray-800 mb-3">
         HIMLT: Hybrid Interactive Machine Learning Tool for Histopathology Image Analysis.
      </h1>
    </div>

    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* LEFT SIDEBAR */}
      <div className="lg:col-span-1 space-y-4">
	{/* Dataset Selector */}
        <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
          <div className="flex items-center mb-4">
            <Database className="text-blue-600 mr-3" size={24} />
            <h3 className="text-xl font-semibold text-gray-800">Dataset</h3>
          </div>
          <select
            value={selectedDataset?.id || ''}
            onChange={(e) => {
              const ds = datasets.find(d => d.id === Number(e.target.value));
              if (ds) handleDatasetSelect(ds);
            }}
            className="w-full p-3 border-2 border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            disabled={loadingDatasets}
          >
            <option value="">
              {loadingDatasets ? 'Loading...' : 'Select Dataset'}
            </option>
            {datasets.map(ds => (
              <option key={ds.id} value={ds.id}>
                {ds.name} ({ds.slide_count} slides)
              </option>
            ))}
          </select>
          <div className="mt-2 text-sm text-gray-500">
            {selectedDataset
              ? `${selectedDataset.slide_count} slides available`
              : loadingDatasets
                ? 'Loading...'
                : 'Select a dataset to continue'}
          </div>
        </div>
	{/* Slide Selector */}
        <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
          <div className="flex items-center mb-4">
            <Layers className="text-green-600 mr-3" size={24} />
            <h3 className="text-xl font-semibold text-gray-800">Slide</h3>
          </div>
          <select
            value={selectedSlide?.id || ''}
            onChange={(e) => {
              const sl = slides.find(s => s.id === Number(e.target.value));
              if (sl) handleSlideSelect(sl);
            }}
            className="w-full p-3 border-2 border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            disabled={!selectedDataset || loadingSlides || slides.length === 0}
          >
            <option value="">
              {!selectedDataset
                ? 'Select dataset first'
                : loadingSlides
                  ? 'Loading...'
                  : slides.length === 0
                    ? 'No slides available'
                    : 'Select Slide'}
            </option>
            {slides.map(sl => (
              <option key={sl.id} value={sl.id}>
                {sl.name} ({sl.x_size}×{sl.y_size})
              </option>
            ))}
          </select>
          <div className="mt-2 text-sm text-gray-500">
            {selectedSlide
              ? `${selectedSlide.x_size}×${selectedSlide.y_size}`
              : !selectedDataset
                ? 'Select a dataset first'
                : loadingSlides
                  ? 'Loading...'
                  : 'Select a slide to continue'}
          </div>
        </div>
        {/* Show Nuclei Button */}
        <button
          onClick={handleSegmentation}
          disabled={!selectedDataset || !selectedSlide || isSegmenting || isTraining}
          className={`w-full flex items-center justify-center px-6 py-4 rounded-xl font-semibold text-white transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none ${
            segmentationComplete
              ? 'bg-green-500 hover:bg-green-600'
              : 'bg-orange-500 hover:bg-orange-600'
          }`}
        >
          <Eye className="mr-3" size={20} />
          {isSegmenting ? (
            <Loader2 className="animate-spin mr-2" size={20} />
          ) : (
            <>
              {segmentationComplete ? `${segmentCount} Nuclei` : 'Show Nuclei'}
            </>
          )}
        </button>

        {/* Training Sample Selection */}
        {segmentationComplete && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold mb-3">Select Training Samples</h3>

            {/* Label selection buttons */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => handleLabelSwitch('positive')}
                className={`flex-1 px-4 py-2 rounded-lg font-medium ${
                  currentLabel === 'positive'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Positive
              </button>
              <button
                onClick={() => handleLabelSwitch('negative')}
                className={`flex-1 px-4 py-2 rounded-lg font-medium ${
                  currentLabel === 'negative'
                    ? 'bg-yellow-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Negative
              </button>
            </div>

            <div className="text-center text-lg font-semibold mb-2">
              <span className={positiveCount === 4 ? 'text-green-600' : 'text-gray-600'}>
                {positiveCount}/4 Positive
              </span>
              {' · '}
              <span className={negativeCount === 4 ? 'text-yellow-600' : 'text-gray-600'}>
                {negativeCount}/4 Negative
              </span>
            </div>

            <p className="text-sm text-gray-500 text-center mb-3">
              Click nuclei on the image to select
            </p>

            {selectedSamples.length > 0 && (
              <button
                onClick={() => setSelectedSamples([])}
                className="w-full px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm"
              >
                Clear All ({selectedSamples.length})
              </button>
            )}
	   {/* Iteration Info Display */}
            {iterationCount > 0 && (
              <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium text-blue-800">
                  Iteration: {iterationCount}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Total training samples: {allTrainingSamples.length}
                </p>
          </div>
        )}
        </div>
       )}

        {/* Train Button */}
        <button
          onClick={handleTraining}
          disabled={!canTrain || isTraining || selectedSamples.length !== 8}
          className={`w-full px-6 py-4 rounded-xl font-semibold text-white transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none ${
            canTrain && !isTraining
              ? 'bg-purple-500 hover:bg-purple-600'
              : 'bg-gray-400'
          }`}
        >
          <Brain className="inline mr-2" size={20} />
          {isTraining 
            ? `Training... ${trainingProgress}%` 
            : iterationCount > 0 
              ? `Refine Model (Iteration ${iterationCount + 1})`
              : 'Train Model'} 
	</button>

        {isTraining && (
          <div className="bg-white rounded-xl shadow-lg p-4">
            <div className="flex justify-between text-sm mb-2">
              <span>Progress</span>
              <span>{trainingProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-purple-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${trainingProgress}%` }}
              />
            </div>
          </div>
        )}

        {predictions.length > 0 && (
  	  <div className="bg-white rounded-xl shadow-lg p-4">
            <h3 className="font-semibold mb-3">Predictions</h3>
            <div className="space-y-2 text-sm">
              <p className="text-gray-600">
                 {predictions.length} total predictions
              </p>
             <p className="text-gray-600">
        	<span className="font-medium" style={{color: '#FF00FF'}}>
          	  {predictions.filter(p => p.prediction === 'positive').length}
        	</span> Positive
      	     </p>
      	     <p className="text-gray-600">
                <span className="font-medium" style={{color: '#00FFFF'}}>
          	  {predictions.filter(p => p.prediction === 'negative').length}
        	</span> Negative
      	     </p>
    	   </div>
	   {/* Iterative Learning Help Text */}
           <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-xs font-medium text-yellow-800 mb-1">
                 Iterative Learning
              </p>
              <p className="text-xs text-yellow-700">
                Select 4 more positive + 4 negative samples from predictions to refine the model
              </p>
            </div>
	</div>
	)}
      {/* Heatmap Controls */}
      	{predictions.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-4">
            <h3 className="font-semibold mb-2">Current View</h3>
            
            <div className="p-2 bg-gray-100 rounded mb-3 text-sm text-center font-medium">
            {showHeatmap ? 'Heatmap (Zoomed Out)' : showPredictions ? 'Predictions (Zoomed In)' : 'Nuclei Selection'}
	    </div>
            
            <p className="text-xs text-gray-600 mb-2">
              Auto-switches based on zoom level
            </p>
            
            {showHeatmap && (
             <>
              <div className="border-t pt-3">
                <label className="block text-xs font-medium mb-2">
                  Resolution: {heatmapBinSize}px
                </label>
                <input
                  type="range"
                  min="50"
                  max="300"
                  step="50"
                  value={heatmapBinSize}
                  onChange={(e) => setHeatmapBinSize(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Fine</span>
                  <span>Coarse</span>
                </div>
              </div>
	      
             <div className="mt-3 p-2 bg-gray-50 rounded">
     		 <p className="text-xs font-medium mb-2">Density:</p>
      		 <div className="flex items-center gap-2 text-xs">
        	   <div className="w-6 h-3" style={{background: 'linear-gradient(to right, #0000FF, #FF0000, #FFFF00)'}}></div>
                   <span>Low → High</span>
      		 </div>
    		</div>
  	       </> 
            )}
          </div>
        )}
{/* Model Management */}
{segmentationComplete && !isTraining && (
  <div className="bg-white rounded-xl shadow-lg p-6">
    <h3 className="text-lg font-semibold mb-3">Model Management</h3>

    {/* Model Selection Dropdown */}
    <div className="mb-3">
      <label className="block text-sm font-medium mb-2 text-gray-700">
        Select Model for Prediction:
      </label>
      <select
        value={selectedModelForPrediction || ''}
        onChange={(e) => setSelectedModelForPrediction(e.target.value)}
        className="w-full p-2 border-2 border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100"
        disabled={loadingModels} 
     >
        <option value="">
    	   {loadingModels 
      		? 'Loading models...' 
      		: availableModels.length === 0 
        		? 'No models available' 
        		: `Select from ${availableModels.filter(m => m.is_valid).length} models`}
  	</option>
	{availableModels
          .filter(model => model.is_valid)
          .map((model) => (
            <option key={model.slide_name} value={model.slide_name}>
              {model.slide_name}
              {model.slide_name === selectedSlide?.name ? ' (same slide)' : ''}
            </option>
          ))}
      </select>
      
      {availableModels.filter(m => m.is_valid).length === 0 && availableModels.length > 0 && (
        <p className="text-xs text-red-600 mt-1">All models are corrupted</p>
      )}
    </div>

    {/* Transfer Learning indicator */}
    {selectedModelForPrediction && selectedModelForPrediction !== selectedSlide?.name && (
      <div className="mb-3 p-3 bg-yellow-50 border-2 border-yellow-300 rounded-lg">
        <p className="text-xs font-semibold text-yellow-800 mb-1">Transfer Learning</p>
        <p className="text-xs text-yellow-700">
          Using model from <span className="font-medium">{selectedModelForPrediction}</span> on current slide.
        </p>
      </div>
    )}


    {/* Run Predictions Button */}
    <button
      onClick={handleUseExistingModel}
      disabled={!selectedModelForPrediction}
      className="w-full mb-3 px-6 py-3 rounded-xl font-semibold text-white bg-purple-500 hover:bg-purple-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Brain className="inline mr-2" size={20} />
      {selectedModelForPrediction 
        ? `Run Predictions with ${selectedModelForPrediction === selectedSlide?.name ? 'Current' : 'Selected'} Model`
        : 'Select Model First'}
    </button>

    {/* Toggle Model List */}
    <button
      onClick={() => {
	fetchAvailableModels();
        setShowModelManager(!showModelManager);
      }}
      className="w-full px-4 py-2 rounded-lg text-sm text-gray-700 bg-gray-100 hover:bg-gray-200"
    >
      {showModelManager 
        ? `Hide Model Details (${availableModels.filter(m => m.is_valid).length} valid)` 
        : `Show Model Details (${availableModels.filter(m => m.is_valid).length} available)`}
    </button>

    {/* Model List */}
    {showModelManager && (
      <div className="mt-3 max-h-60 overflow-y-auto border rounded-lg">
        {availableModels.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No models available</p>
        ) : (
          <div className="divide-y">
            {availableModels.map((model) => (
              <div 
                key={model.slide_name} 
                className={`p-3 hover:bg-gray-50 cursor-pointer ${
                  selectedModelForPrediction === model.slide_name ? 'bg-blue-50' : ''
                }`}
                onClick={() => model.is_valid && setSelectedModelForPrediction(model.slide_name)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {model.slide_name}
                      {selectedModelForPrediction === model.slide_name && ' ✓'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {model.size_mb.toFixed(2)} MB • {model.created}
                    </p>
                    {!model.is_valid && (
                      <p className="text-xs text-red-600 font-medium">corrupted - Cannot Use</p>
                    )}
                    {model.slide_name === selectedSlide?.name && (
                      <p className="text-xs text-green-600 font-medium">Same Slide</p>
                    )}
                    {model.slide_name !== selectedSlide?.name && model.is_valid && (
                      <p className="text-xs text-blue-600">Available for Transfer Learning</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
)}

</div>
      {/* END LEFT SIDEBAR */}
	{/* RIGHT VIEWER */}
      <div className="lg:col-span-3">
        <div className="bg-white rounded-xl shadow-lg p-8 h-full min-h-[600px]">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-semibold text-gray-800">Slide Viewer</h3>
            <div className="flex space-x-2">
              {selectedSlide && viewer && (
                <>
                  <button
                    onClick={() => viewer?.viewport?.zoomBy(1.5)}
                    disabled={!selectedSlide || !viewer}
                    className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 text-sm"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    onClick={() => viewer?.viewport?.zoomBy(0.67)}
                    disabled={!selectedSlide || !viewer}
                    className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 text-sm"
                    title="Zoom Out"
                  >
                    -
                  </button>
                  <button
                    onClick={() => viewer?.viewport?.goHome()}
                    disabled={!selectedSlide || !viewer}
                    className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 text-sm"
                    title="Reset View"
                  >
                    Reset
                  </button>
                </>
              )}
            </div>
          </div>

          {selectedSlide ? (
            <div className="relative">
              {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg z-10">
                  <div className="text-white text-center">
                    <Loader2 className="animate-spin mx-auto mb-2" size={32} />
                    <p>Loading slide image...</p>
                    <p className="text-sm opacity-75 mt-2">
                      Path: {selectedSlide.pyramid_path}
                    </p>
                  </div>
                </div>
              )}

              {imageError && (
                <div className="absolute top-4 left-4 right-4 p-4 bg-red-100 border border-red-300 text-red-800 rounded-lg z-10">
                  <p>
                    <strong>Error:</strong> {imageError}
                  </p>
                </div>
              )}

              <div
                ref={viewerRef}
                className="w-full h-96 border border-gray-300 rounded-lg bg-gray-50"
                style={{
                  minHeight: '500px',
                  imageRendering: 'crisp-edges',
                }}
              />

              {segmentationComplete && (
                <div className="mt-4 px-4 py-2 bg-green-100 text-green-800 rounded-lg inline-block">
                  Total nuclei : {segmentCount} items
                </div>
              )}
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-300 rounded-xl h-96 flex items-center justify-center">
              <div className="text-center">
                <Layers className="mx-auto mb-4" size={64} />
                <p className="text-xl text-gray-500">No slide selected</p>
                <p className="text-sm text-gray-400 mt-2">
                  Select a dataset and slide to begin analysis
                </p>
              </div>
            </div>
          )}

          {segmentationComplete && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2">Legend:</h4>
              <div className="space-y-2 text-sm">
                {/* Training Sample Colors - Always show */}
                <div className="flex items-center">
                  <div className="w-4 h-4 rounded mr-2 border-2" style={{backgroundColor: '#FFA500', borderColor: '#00FF00'}}></div> 
                  <span>Selected Positive (Training)</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 rounded mr-2 border-2" style={{backgroundColor: '#FFA500', borderColor: '#FF0000'}}></div>
                  <span>Selected Negative (Training)</span>
                </div>
                <div className="flex items-center">
           	   <div className="w-4 h-4 rounded mr-2" style={{backgroundColor: '#FFFF00'}}></div>
            	   <span>Unselected Nuclei (Yellow dots)</span>
          	</div>

                {/* Prediction Colors - Show after predictions load */}
                {predictions.length > 0 && (
                  <>
                    <hr className="my-2 border-gray-300" />
                    <div className="flex items-center">
                      <div className="w-4 h-4 rounded mr-2" style={{backgroundColor: '#FF00FF'}}></div>
                      <span>Predicted Positive</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-4 h-4 rounded mr-2" style={{backgroundColor: '#00FFFF'}}></div>
                      <span>Predicted Negative</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-4 h-4 rounded mr-2 border-2" style={{backgroundColor: '#FFA500', borderColor: '#00FF00'}}></div>
                      <span>Training: Positive (in predictions)</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-4 h-4 rounded mr-2 border-2" style={{backgroundColor: '#FFA500', borderColor: '#FF0000'}}></div>
                      <span>Training: Negative (in predictions)</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* END RIGHT VIEWER */}
    </div>
  </div>
);
};

export default HistomicsTrainingAnalysis;
