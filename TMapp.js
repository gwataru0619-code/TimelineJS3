// プロジェクト表示名の変換
const projectNames = {
    "fsn_cluster": "Fate/stay night Project",
    "tsuki_cluster": "真月譚 月姫 Project",
    "knk_cluster": "空の境界 Project"
};

let masterData = null;
let currentDisplayedEvents = [];
let timeline = null;
let expandedParentIds = new Set();
let pendingSlideId = null;
let selectedFamilyParentId = null;

// JSONの読み込み
async function initApp() {
    try {
        const response = await fetch('TMdata.json');
        masterData = normalizeTimelineData(await response.json());
        updateTimeline();
    } catch (error) {
        console.error("データの読み込みに失敗しました:", error);
    }
}

function normalizeTimelineData(data) {
    const usedIds = new Set();

    data.events = data.events.map((event, index) => {
        const normalized = { ...event };

        if (!normalized.unique_id) {
            normalized.unique_id = normalized.id || makeEventId(normalized, index);
        }

        if (!normalized.id) {
            normalized.id = normalized.unique_id;
        }

        if (usedIds.has(normalized.unique_id)) {
            normalized.unique_id = `${normalized.unique_id}_${index}`;
        }

        usedIds.add(normalized.unique_id);
        return normalized;
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

function getGroupName(event, mode) {
    if (mode === 'media') return event.custom_tags.media;
    const pid = event.custom_tags.project_id;
    return projectNames[pid] || pid;
}

function updateTimeline() {
    if (!masterData) return;

    const searchText = document.getElementById('search-input').value.toLowerCase();
    const selectedSeries = Array.from(document.querySelectorAll('.filter-series:checked')).map(el => el.value);
    const selectedMedia = Array.from(document.querySelectorAll('.filter-media:checked')).map(el => el.value);
    const groupMode = document.querySelector('input[name="group-mode"]:checked').value;

    const parents = masterData.events.filter(ev => {
        const isSeriesBar = ev.custom_tags.type === 'series_bar';
        return isSeriesBar && matchesFilters(ev, searchText, selectedSeries, selectedMedia);
    });

    const visibleParentIds = new Set(parents.map(ev => ev.unique_id));
    if (selectedFamilyParentId && !visibleParentIds.has(selectedFamilyParentId)) {
        selectedFamilyParentId = null;
        pendingSlideId = null;
    }

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
    const container = document.getElementById("timeline-embed");
    container.removeEventListener('click', handleTimelineContainerClick, true);
    container.innerHTML = "";
    
    timeline = new TL.Timeline("timeline-embed", data, {
        language: "ja",
        initial_zoom: 2
    });

    timeline.on('loaded', () => {
        if (slideIdToRestore && currentDisplayedEvents.some(ev => ev.unique_id === slideIdToRestore)) {
            timeline.goToId(slideIdToRestore);
            pendingSlideId = null;
        }
        applyFamilyHighlight();
    });

    container.addEventListener('click', handleTimelineContainerClick, true);
    timeline.on('change', handleTimelineChange);
}

function handleTimelineContainerClick(event) {
    const marker = event.target.closest('.tl-timemarker');
    if (!marker || !marker.id || !marker.id.endsWith('-marker')) {
        return;
    }

    const eventId = marker.id.replace(/-marker$/, '');
    const eventData = findEventById(eventId);
    if (!eventData || eventData.custom_tags.type !== 'series_bar') {
        return;
    }

    const hasDetails = masterData.events.some(ev => ev.parent_id === eventData.unique_id);
    if (hasDetails && selectedFamilyParentId === eventData.unique_id && !expandedParentIds.has(eventData.unique_id)) {
        expandedParentIds.add(eventData.unique_id);
        pendingSlideId = eventData.unique_id;
        updateTimeline();
    }
}

function handleTimelineChange() {
    const slide = timeline.getCurrentSlide();
    const slideData = slide && slide.data;

    if (!slideData || !slideData.unique_id) {
        return;
    }

    const parentId = getFamilyParentId(slideData);
    if (parentId) {
        selectedFamilyParentId = parentId;
        pendingSlideId = slideData.unique_id;
    } else {
        selectedFamilyParentId = null;
        pendingSlideId = null;
    }

    applyFamilyHighlight();
}

function getFamilyParentId(event) {
    if (!event.custom_tags) return null;
    if (event.custom_tags.type === 'series_bar') return event.unique_id;
    if (event.parent_id) return event.parent_id;
    return null;
}

function findEventById(id) {
    return masterData.events.find(ev => ev.unique_id === id || ev.id === id);
}

function getSelectedFamilyIds() {
    if (!selectedFamilyParentId) return new Set();

    const ids = new Set([selectedFamilyParentId]);
    currentDisplayedEvents.forEach(ev => {
        if (ev.parent_id === selectedFamilyParentId) {
            ids.add(ev.unique_id);
        }
    });

    return ids;
}

function applyFamilyHighlight() {
    const familyIds = getSelectedFamilyIds();
    const hasSelection = familyIds.size > 0;

    currentDisplayedEvents.forEach(ev => {
        const isFamily = familyIds.has(ev.unique_id);
        const marker = document.getElementById(`${ev.unique_id}-marker`);
        const slide = document.getElementById(ev.unique_id);

        [marker, slide].forEach(el => {
            if (!el) return;
            el.classList.toggle('tm-family-highlight', isFamily);
            el.classList.toggle('tm-family-dimmed', hasSelection && !isFamily);
        });
    });
}

// 起動
document.addEventListener('DOMContentLoaded', initApp);
document.getElementById('apply-filters').addEventListener('click', updateTimeline);
