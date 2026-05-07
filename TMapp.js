// プロジェクト表示名の変換
const projectNames = {
    "fsn_cluster": "Fate/stay night Project",
    "tsuki_cluster": "真月譚 月姫 Project",
    "knk_cluster": "空の境界 Project"
};

const timelineOptions = {
    language: "ja",
    initial_zoom: 2,
    timenav_height_percentage: 55,
    timenav_height_min: 560,
    marker_height_min: 36,
    marker_width_min: 140,
    marker_padding: 8
};

const baseTimenavHeightMin = timelineOptions.timenav_height_min;
const baseTimelineContainerHeight = 1100;
const autoLayoutIncrement = 300;
const maxAutoLayoutPasses = 30;
const autoLayoutCheckDelay = 350;

let masterData = null;
let currentDisplayedEvents = [];
let timeline = null;
let expandedParentIds = new Set();
let pendingSlideId = null;
let currentTimenavHeightMin = baseTimenavHeightMin;
let autoLayoutPasses = 0;
let renderGeneration = 0;

// JSONの読み込み
async function initApp() {
    try {
        const response = await fetch('TMdata.json');
        masterData = normalizeTimelineData(await response.json());
        buildFilterControls();
        updateTimeline();
    } catch (error) {
        console.error("データの読み込みに失敗しました:", error);
    }
}

function normalizeTimelineData(data) {
    const usedIds = new Set();

    data.events = data.events.map((event, index) => {
        const normalized = { ...event };

        normalized.text = {
            headline: "",
            text: "",
            ...(normalized.text || {})
        };

        if (!normalized.unique_id) {
            normalized.unique_id = normalized.id || makeEventId(normalized, index);
        }

        if (!normalized.id) {
            normalized.id = normalized.unique_id;
        }

        normalized.custom_tags = {
            media: "Other",
            series: "Other",
            project_id: "other_cluster",
            type: normalized.parent_id ? "volume_dot" : "series_bar",
            ...(normalized.custom_tags || {})
        };

        if (usedIds.has(normalized.unique_id)) {
            normalized.unique_id = `${normalized.unique_id}_${index}`;
            normalized.id = normalized.unique_id;
        }

        usedIds.add(normalized.unique_id);
        return normalized;
    });

    const referencedParentIds = new Set(data.events.map(event => event.parent_id).filter(Boolean));
    data.events = data.events.map(event => {
        if (!event.parent_id || referencedParentIds.has(event.unique_id)) {
            return {
                ...event,
                custom_tags: {
                    ...event.custom_tags,
                    type: "series_bar"
                }
            };
        }
        return event;
    });

    return data;
}

function makeEventId(event, index) {
    const headline = event.text && event.text.headline ? event.text.headline : `event_${index}`;
    return headline
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^\w-]/g, "") || `event_${index}`;
}

function buildFilterControls() {
    buildCheckboxGroup('series-filters', 'filter-series', uniqueValues('series'));
    buildCheckboxGroup('media-filters', 'filter-media', uniqueValues('media'));
}

function buildCheckboxGroup(containerId, className, values) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    values.forEach(value => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = className;
        checkbox.value = value;
        checkbox.checked = true;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${displayFilterName(value)}`));
        container.appendChild(label);
    });
}

function uniqueValues(key) {
    return [...new Set(masterData.events.map(ev => ev.custom_tags[key]).filter(Boolean))].sort();
}

function displayFilterName(value) {
    const names = {
        Anime: "アニメ",
        Game: "ゲーム",
        Manga: "漫画",
        Other: "その他",
        Tsukihime: "月姫"
    };
    return names[value] || value;
}

function getGroupName(event, mode) {
    if (mode === 'media') return event.custom_tags.media;
    const pid = event.custom_tags.project_id;
    return projectNames[pid] || pid;
}

function updateTimeline() {
    if (!masterData) return;

    resetAutoLayout();

    const searchText = document.getElementById('search-input').value.toLowerCase();
    const selectedSeries = Array.from(document.querySelectorAll('.filter-series:checked')).map(el => el.value);
    const selectedMedia = Array.from(document.querySelectorAll('.filter-media:checked')).map(el => el.value);
    const groupMode = document.querySelector('input[name="group-mode"]:checked').value;

    const parents = masterData.events.filter(ev => {
        const isSeriesBar = ev.custom_tags.type === 'series_bar';
        return isSeriesBar && matchesFilters(ev, searchText, selectedSeries, selectedMedia);
    });

    const visibleParentIds = new Set(parents.map(ev => ev.unique_id));
    const details = masterData.events.filter(ev => {
        if (!ev.parent_id || !expandedParentIds.has(ev.parent_id)) return false;
        if (!visibleParentIds.has(ev.parent_id)) return false;
        return matchesFilters(ev, searchText, selectedSeries, selectedMedia);
    });

    currentDisplayedEvents = [...parents, ...details].map(ev => ({
        ...ev,
        group: getGroupName(ev, groupMode)
    }));

    render(currentDisplayedEvents, pendingSlideId);
}

function matchesFilters(event, searchText, selectedSeries, selectedMedia) {
    const headline = event.text && event.text.headline ? event.text.headline.toLowerCase() : "";
    const body = event.text && event.text.text ? event.text.text.toLowerCase() : "";
    const matchesSearch = !searchText || headline.includes(searchText) || body.includes(searchText);
    const matchesSeries = selectedSeries.includes(event.custom_tags.series);
    const matchesMedia = selectedMedia.includes(event.custom_tags.media);
    return matchesSearch && matchesSeries && matchesMedia;
}

function render(events, slideIdToRestore) {
    const data = { ...masterData, events: events };
    const generation = ++renderGeneration;
    const container = document.getElementById("timeline-embed");
    setTimelineContainerHeight();
    container.innerHTML = "";
    
    timeline = new TL.Timeline("timeline-embed", data, getTimelineOptions());

    timeline.on('loaded', () => {
        if (slideIdToRestore && currentDisplayedEvents.some(ev => ev.unique_id === slideIdToRestore)) {
            timeline.goToId(slideIdToRestore);
            pendingSlideId = null;
        }
        tagChildDetailMarkers();
        scheduleAutoLayoutCheck(events, slideIdToRestore, generation);
    });

    timeline.on('change', handleTimelineChange);
}

function getTimelineOptions() {
    return {
        ...timelineOptions,
        timenav_height_min: currentTimenavHeightMin
    };
}

function resetAutoLayout() {
    currentTimenavHeightMin = baseTimenavHeightMin;
    autoLayoutPasses = 0;
    updateLayoutDebug(0, 0);
}

function setTimelineContainerHeight() {
    const container = document.getElementById("timeline-embed");
    const desiredHeight = Math.max(baseTimelineContainerHeight, currentTimenavHeightMin + 540);
    container.style.height = `${desiredHeight}px`;
}

function scheduleAutoLayoutCheck(events, slideIdToRestore, generation) {
    setTimeout(() => {
        if (generation !== renderGeneration) return;

        const overlaps = detectMarkerOverlaps();
        const ellipsized = detectEllipsizedMarkers();
        updateLayoutDebug(overlaps.length, ellipsized.length);

        if ((overlaps.length > 0 || ellipsized.length > 0) && autoLayoutPasses < maxAutoLayoutPasses) {
            autoLayoutPasses += 1;
            currentTimenavHeightMin += autoLayoutIncrement;
            render(events, slideIdToRestore);
        }
    }, autoLayoutCheckDelay);
}

function detectMarkerOverlaps() {
    const markers = Array.from(document.querySelectorAll('#timeline-embed .tl-timemarker'));
    const overlaps = [];

    for (let i = 0; i < markers.length; i++) {
        const firstRect = markers[i].getBoundingClientRect();

        for (let j = i + 1; j < markers.length; j++) {
            const secondRect = markers[j].getBoundingClientRect();
            if (rectsOverlap(firstRect, secondRect)) {
                overlaps.push([markers[i].id, markers[j].id]);
            }
        }
    }

    return overlaps;
}

function rectsOverlap(first, second) {
    return !(
        first.right <= second.left ||
        first.left >= second.right ||
        first.bottom <= second.top ||
        first.top >= second.bottom
    );
}

function detectEllipsizedMarkers() {
    return Array.from(document.querySelectorAll('#timeline-embed .tl-timemarker-content'))
        .filter(el => el.scrollWidth > el.clientWidth);
}

function updateLayoutDebug(overlapCount, ellipsizedCount) {
    const debug = document.getElementById('layout-debug');
    if (!debug) return;

    debug.textContent = [
        `layout pass: ${autoLayoutPasses}/${maxAutoLayoutPasses}`,
        `timenav min: ${currentTimenavHeightMin}px`,
        `overlaps: ${overlapCount}`,
        `ellipsis: ${ellipsizedCount}`
    ].join('\n');
}

function tagChildDetailMarkers() {
    currentDisplayedEvents.forEach(event => {
        const marker = document.getElementById(`${event.unique_id}-marker`);
        if (!marker) return;

        marker.classList.toggle('tm-child-detail-marker', Boolean(event.parent_id));
    });
}

function handleTimelineChange() {
    const slide = timeline.getCurrentSlide();
    const slideData = slide && slide.data;

    if (!slideData || !slideData.unique_id) {
        return;
    }

    if (slideData.custom_tags && slideData.custom_tags.type === 'series_bar') {
        const details = masterData.events.filter(ev => ev.parent_id === slideData.unique_id);
        if (details.length > 0 && !expandedParentIds.has(slideData.unique_id)) {
            expandedParentIds.add(slideData.unique_id);
            pendingSlideId = slideData.unique_id;
            updateTimeline();
        }
    }
}

function collapseDetails() {
    expandedParentIds.clear();
    pendingSlideId = null;
    updateTimeline();
}

// 起動
document.addEventListener('DOMContentLoaded', initApp);
document.getElementById('apply-filters').addEventListener('click', updateTimeline);
document.getElementById('collapse-details').addEventListener('click', collapseDetails);
