// プロジェクト表示名の変換
const projectNames = {
    "fsn_cluster": "Fate/stay night Project",
    "tsuki_cluster": "真月譚 月姫 Project",
    "knk_cluster": "空の境界 Project"
};

let masterData = null;
let currentDisplayedEvents = [];
let timeline = null;

// JSONの読み込み
async function initApp() {
    try {
        const response = await fetch('TMdata.json');
        masterData = await response.json();
        updateTimeline();
    } catch (error) {
        console.error("データの読み込みに失敗しました:", error);
    }
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

    const filtered = masterData.events.filter(ev => {
        const matchesSearch = ev.text.headline.toLowerCase().includes(searchText);
        const matchesSeries = selectedSeries.includes(ev.custom_tags.series);
        const matchesMedia = selectedMedia.includes(ev.custom_tags.media);
        const isSeriesBar = ev.custom_tags.type === 'series_bar';
        return matchesSearch && matchesSeries && matchesMedia && isSeriesBar;
    });

    currentDisplayedEvents = filtered.map(ev => ({
        ...ev,
        group: getGroupName(ev, groupMode)
    }));

    render(currentDisplayedEvents);
}

function render(events) {
    const data = { ...masterData, events: events };
    document.getElementById("timeline-embed").innerHTML = "";
    
    timeline = new TL.Timeline("timeline-embed", data, {
        language: "ja",
        initial_zoom: 2
    });

    timeline.on('change', () => {
        const slide = timeline.getCurrentSlide();
        const slideData = slide.data;
        const groupMode = document.querySelector('input[name="group-mode"]:checked').value;

        if (slideData && slideData.id) {
            const details = masterData.events.filter(ev => ev.parent_id === slideData.id);
            let added = false;
            details.forEach(detail => {
                if (!currentDisplayedEvents.find(curr => curr.headline === detail.headline)) {
                    currentDisplayedEvents.push({ ...detail, group: getGroupName(detail, groupMode) });
                    added = true;
                }
            });
            if (added) {
                render(currentDisplayedEvents);
                timeline.goToId(slideData.id);
            }
        }
    });
}

// 起動
document.addEventListener('DOMContentLoaded', initApp);
document.getElementById('apply-filters').addEventListener('click', updateTimeline);
