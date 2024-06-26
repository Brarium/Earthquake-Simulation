// Initialize i18next for internationalization
i18next
  .use(i18nextBrowserLanguageDetector)
  .use(i18nextHttpBackend)
  .init({
    fallbackLng: 'en',
    backend: {
      loadPath: '/Earthquake-Simulation/locales/{{lng}}/translation.json',
      crossDomain: true,
      requestOptions: {
        mode: 'no-cors',
        credentials: 'same-origin',
        cache: 'default'
      }
    }
  }, function(err, t) {
    updateContent();
  });

function updateContent() {
  document.querySelectorAll('[data-i18n]').forEach(function(element) {
    element.innerHTML = i18next.t(element.getAttribute('data-i18n'));
  });
}

// Language switcher
document.getElementById('language-select').addEventListener('change', function() {
  const selectedLanguage = this.value;
  i18next.changeLanguage(selectedLanguage, updateContent);
});

mapboxgl.accessToken = 'pk.eyJ1IjoibWluY2hvbWFjaG8iLCJhIjoiY2x3aDY2eGFpMDYzMzJrbXBzcmpoZnc3MCJ9.V5YaMHi7CRVuB6wOvfZVNA';
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v11',
  center: [138.2529, 36.2048],
  zoom: 5
});

let earthquakeData = [];
let currentStep = 0;
let totalSteps = 100;
let isPlaying = false;
let playInterval;
let showHotspots = false;
let debounceTimeout;

document.getElementById('simulate-btn').addEventListener('click', simulateEarthquakes);
document.getElementById('toggle-hotspots-btn').addEventListener('click', toggleHotspots);
document.getElementById('time-slider').addEventListener('input', debounce(handleTimeSlider, 200));
document.getElementById('play-pause-btn').addEventListener('click', togglePlayback);
document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
document.getElementById('export-results-btn').addEventListener('click', exportResults);
document.getElementById('submit-feedback').addEventListener('click', submitFeedback);

function simulateEarthquakes() {
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const minMagnitude = parseFloat(document.getElementById('min-magnitude').value);
  const maxMagnitude = parseFloat(document.getElementById('max-magnitude').value);

  if (startDate && endDate && minMagnitude && maxMagnitude) {
    const apiUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${startDate}&endtime=${endDate}&minlatitude=24&maxlatitude=46&minlongitude=122&maxlongitude=146&minmagnitude=${minMagnitude}&maxmagnitude=${maxMagnitude}`;
    console.log('Fetching data from URL:', apiUrl);

    document.getElementById('loading-indicator').style.display = 'block';

    fetch(apiUrl)
      .then(response => response.json())
      .then(data => {
        console.log('Received data:', data);
        earthquakeData = data.features;
        earthquakeData.sort((a, b) => new Date(a.properties.time) - new Date(b.properties.time)); // Sort by date
        currentStep = 0;
        document.getElementById('time-slider').value = 0;
        document.getElementById('time-slider').max = earthquakeData.length - 1;
        updateMap();
        updateSignificantList();
        startPlayback();
      })
      .catch(error => console.error('Error fetching earthquake data:', error))
      .finally(() => {
        document.getElementById('loading-indicator').style.display = 'none';
      });
  } else {
    alert('Please select valid dates and magnitude range.');
  }
}

function handleTimeSlider() {
  currentStep = parseInt(this.value);
  requestAnimationFrame(updateMap);
}

function togglePlayback() {
  if (isPlaying) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function saveSettings() {
  const settings = {
    startDate: document.getElementById('start-date').value,
    endDate: document.getElementById('end-date').value,
    minMagnitude: parseFloat(document.getElementById('min-magnitude').value),
    maxMagnitude: parseFloat(document.getElementById('max-magnitude').value),
    playbackSpeed: parseInt(document.getElementById('playback-speed').value, 10)
  };
  localStorage.setItem('earthquakeSimSettings', JSON.stringify(settings));
  alert('Settings saved!');
}

function exportResults() {
  const results = earthquakeData.map(earthquake => ({
    magnitude: earthquake.properties.mag,
    place: earthquake.properties.place,
    time: new Date(earthquake.properties.time).toLocaleString()
  }));
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  saveAs(blob, 'earthquake_results.json');
}

function submitFeedback() {
  const feedback = document.getElementById('feedback').value;
  if (feedback) {
    alert('Thank you for your feedback!');
    document.getElementById('feedback').value = '';
  } else {
    alert('Please enter your feedback.');
  }
}

function updateMap() {
  const layers = map.getStyle().layers;
  if (layers) {
    layers.forEach(layer => {
      if (layer.id.startsWith('circle-') || layer.id.startsWith('hotspot-') || layer.id.startsWith('shockwave-')) {
        map.removeLayer(layer.id);
        map.removeSource(layer.id);
      }
    });
  }

  if (earthquakeData.length === 0) return;

  const startIndex = Math.max(0, currentStep - 100);
  const stepData = earthquakeData.slice(startIndex, currentStep + 1);

  stepData.forEach(earthquake => {
    const coords = earthquake.geometry.coordinates;
    const magnitude = earthquake.properties.mag;
    const color = getColor(magnitude);
    const circleRadius = getCircleRadius(magnitude);

    const id = `circle-${coords[0]}-${coords[1]}-${new Date(earthquake.properties.time).getTime()}`;
    if (map.getLayer(id)) {
      fadeOutLayer(id, magnitude);
    }

    map.addLayer({
      id: id,
      type: 'circle',
      source: {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [coords[0], coords[1]]
          }
        }
      },
      paint: {
        'circle-radius': circleRadius,
        'circle-color': color,
        'circle-opacity': 0.6
      }
    });

    const popup = new mapboxgl.Popup({ offset: 25 })
      .setHTML(`<h4>${earthquake.properties.place}</h4><p>Magnitude: ${magnitude}</p><p>${new Date(earthquake.properties.time).toLocaleString()}</p>`);
    map.on('click', id, () => {
      popup.setLngLat([coords[0], coords[1]])
        .addTo(map);
    });
  });

  updateEarthquakeDetails(stepData);

  if (showHotspots) {
    drawHotspots();
  }
}

function fadeOutLayer(layerId, magnitude) {
  let opacity = 0.6;
  const duration = getFadeOutDuration(magnitude);
  const interval = setInterval(() => {
    if (map.getLayer(layerId)) {
      opacity -= 0.1;
      if (opacity <= 0) {
        clearInterval(interval);
        map.removeLayer(layerId);
        map.removeSource(layerId);
      } else {
        map.setPaintProperty(layerId, 'circle-opacity', opacity);
      }
    } else {
      clearInterval(interval);
    }
  }, duration / 6);
}

function getFadeOutDuration(magnitude) {
  if (magnitude >= 7) return 2000;
  if (magnitude >= 6) return 1500;
  if (magnitude >= 5) return 1000;
  return 500;
}

function getColor(magnitude) {
  if (magnitude >= 9) return '#000000';
  if (magnitude >= 7) return '#d73027';
  if (magnitude >= 6) return '#fc8d59';
  if (magnitude >= 5) return '#fee08b';
  if (magnitude < 5) return '#d9d9d9'; // Color for magnitudes below 5
  return '#91cf60';
}

function getCircleRadius(magnitude) {
  return magnitude * 5;
}

function updateEarthquakeDetails(stepData) {
  if (stepData.length === 0) {
    document.getElementById('earthquake-details').innerHTML = i18next.t('no-data');
    return;
  }

  const latestEarthquake = stepData[stepData.length - 1];
  const place = latestEarthquake.properties.place;
  const magnitude = latestEarthquake.properties.mag;
  const time = new Date(latestEarthquake.properties.time).toLocaleString();
  document.getElementById('earthquake-details').innerHTML = `
    <strong>${i18next.t('location')}:</strong> ${place} <br>
    <strong>${i18next.t('magnitude')}:</strong> ${magnitude} <br>
    <strong>${i18next.t('time')}:</strong> ${time} <br>
    ${latestEarthquake.properties.title}
  `;
}

function updateSignificantList() {
  const list = document.getElementById('significant-list');
  list.innerHTML = '';

  earthquakeData.forEach((earthquake, index) => {
    const magnitude = earthquake.properties.mag;
    if (magnitude >= 7) {
      const place = earthquake.properties.place;
      const time = new Date(earthquake.properties.time).toLocaleString();
      const newsUrl = `https://www.google.com/search?q=${encodeURIComponent(place + ' earthquake ' + magnitude)}`;
      const listItem = document.createElement('tr');
      listItem.innerHTML = `
        <td>${magnitude}</td>
        <td class="epicenter" data-index="${index}">${place}</td>
        <td><a href="${newsUrl}" target="_blank">${time}</a></td>
      `;
      listItem.querySelector('.epicenter').addEventListener('click', () => {
        moveToEarthquake(index);
      });
      list.appendChild(listItem);
    }
  });
}

function moveToEarthquake(index) {
  currentStep = index;
  document.getElementById('time-slider').value = currentStep;
  updateMap();
  const earthquake = earthquakeData[index];
  zoomToLocation(earthquake);
  updateEarthquakeDetails([earthquake]);
}

function zoomToLocation(earthquake) {
  const coords = earthquake.geometry.coordinates;
  map.flyTo({
    center: [coords[0], coords[1]],
    zoom: 10,
    essential: true
  });
}

function startPlayback() {
  isPlaying = true;
  document.getElementById('play-pause-btn').innerText = i18next.t('pause');
  const speed = parseInt(document.getElementById('playback-speed').value, 10) || 1000;
  playInterval = setInterval(() => {
    if (currentStep < earthquakeData.length - 1) {
      currentStep++;
      document.getElementById('time-slider').value = currentStep;
      requestAnimationFrame(updateMap);
    } else {
      pausePlayback();
    }
  }, speed);
}

function pausePlayback() {
  isPlaying = false;
  document.getElementById('play-pause-btn').innerText = i18next.t('play');
  clearInterval(playInterval);
}

function toggleHotspots() {
  showHotspots = !showHotspots;
  if (showHotspots) {
    drawHotspots();
  } else {
    clearHotspots();
  }
}

function drawHotspots() {
  const maxMagnitudeEarthquake = earthquakeData.reduce((max, earthquake) => earthquake.properties.mag > max.properties.mag ? earthquake : max, earthquakeData[0]);
  const mainCoords = maxMagnitudeEarthquake.geometry.coordinates;

  earthquakeData.forEach(earthquake => {
    const coords = earthquake.geometry.coordinates;
    const id = `hotspot-${coords[0]}-${coords[1]}`;

    map.addLayer({
      id: id,
      type: 'circle',
      source: {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [coords[0], coords[1]]
          }
        }
      },
      paint: {
        'circle-radius': 3,
        'circle-color': '#000000',
        'circle-opacity': 1
      }
    });

    const shockwaveLayer = {
      id: `shockwave-${coords[0]}-${coords[1]}`,
      type: 'heatmap',
      source: {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [coords[0], coords[1]]
          }
        }
      },
      paint: {
        'heatmap-weight': {
          property: 'mag',
          type: 'exponential',
          stops: [
            [0, 0],
            [6, 1]
          ]
        },
        'heatmap-intensity': {
          stops: [
            [0, 0],
            [5, 1.2]
          ]
        },
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(33,102,172,0)',
          0.2, 'rgba(103,169,207,0.6)',
          0.4, 'rgba(209,229,240,0.8)',
          0.6, 'rgba(253,219,199,0.9)',
          0.8, 'rgba(239,138,98,0.9)',
          1, 'rgba(178,24,43,0.9)'
        ],
        'heatmap-radius': {
          stops: [
            [0, 2],
            [5, 15]
          ]
        },
        'heatmap-opacity': {
          default: 1,
          stops: [
            [14, 1],
            [15, 0]
          ]
        },
      }
    };

    map.addLayer(shockwaveLayer);
  });
}

function clearHotspots() {
  const layers = map.getStyle().layers;
  if (layers) {
    layers.forEach(layer => {
      if (layer.id.startsWith('hotspot-') || layer.id.startsWith('shockwave-')) {
        map.removeLayer(layer.id);
        map.removeSource(layer.id);
      }
    });
  }
}

function debounce(func, wait) {
  return function() {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, arguments), wait);
  };
}
