// --- 設定・準備エリア ---

// プロジェクトのID（短い名前）を、画面に表示するための正式名称に変換する辞書です
const projectNames = {
    "fsn_cluster": "Fate/stay night Project",
    "tsuki_cluster": "真月譚 月姫 Project",
    "knk_cluster": "空の境界 Project"
};
// 上画面（スライド）の固定したい高さ（ピクセル）
const FIXED_SLIDE_HEIGHT = 450;

// 年表（TimelineJS）の見た目や動きを細かく決める設定値です
const timelineOptions = {
    language: "ja",                   // 日本語表示
    initial_zoom: 2,                  // 最初のズーム倍率
    marker_height_min: 36,            // マーカーの最小の高さ
    marker_width_min: 140,            // マーカーの最小の幅
    marker_padding: 8                 // マーカー同士の隙間
};

// 手動で縦幅を伸ばすための基準値と増分です
const baseTimelineHeight = 2300;
const baseTimenavHeightMin = 560;
const heightIncreaseStep = 300;
const timenavIncreaseStep = 180;

// project_idごとの色設定です。必要に応じてここを書き換えれば色を固定できます
const projectColors = {
    staynight: "#ad1457",
    hollowataraxia: "#d81b60",
    Zero: "#7b1fa2",
    kaleidliner: "#9c27b0",
    Apocrypha: "#c62828",
    Prototype: "#1565c0",
    "El-MelloiII": "#6d4c41",
    strangeFake: "#e65100",
    GrandOrder: "#ff8f00",
    Extra: "#311b92",
    Requiem: "#006064",
    LostEinherjar: "#33691e",
    SamuraiRemnant: "#558b2f",
    TheGardenofSinners: "#1a237e",
    Tsukihime: "#0277bd",
    MELTYBLOOD: "#0288d1",
    KOHAA: "#039be5",
    Ahnenerbe: "#03a9f4",
    Mahoyo: "#01579b", 
    others: "#666666"
};
const fallbackMarkerColor = "#666666";

// アプリ全体で使う「作業用ポケット（変数）」です
let masterData = null;                // 読み込んだ全てのデータ
let currentDisplayedEvents = [];      // 今、画面に表示しているデータ
let timeline = null;                  // 作成された年表本体
let expandedParentIds = new Set();    // 今、詳細が開かれている項目のリスト
let pendingSlideId = null;            // 次に表示したいスライドの予約番号
let timelineHeight = baseTimelineHeight;       // 現在のタイムライン表示領域の高さ
let timenavHeightMin = baseTimenavHeightMin;   // 現在の時間軸ナビの最小高さ

// --- アプリ起動の処理 ---

// アプリの「起動スイッチ」です。データを読み込んで準備を始めます
async function initApp() {
    try {
        // 分割したJSONを優先して読み込みます。失敗した時だけ旧TMdata.jsonへ戻します
        masterData = normalizeTimelineData(await loadTimelineData());
        // 画面に「絞り込みボタン」を作ります
        buildFilterControls();
        // 準備ができたので年表を画面に描きます
        updateTimeline();
    } catch (error) {
        console.error("データの読み込みに失敗しました:", error);
    }
}

// TMdata/index.jsonに書かれた複数JSONを読み込み、1つのTimelineJS用データにまとめます
async function loadTimelineData() {
    try {
        const indexResponse = await fetch('TMdata/index.json');
        if (!indexResponse.ok) throw new Error(`TMdata/index.json: ${indexResponse.status}`);

        const indexData = await indexResponse.json();
        const sourceEvents = await Promise.all(indexData.sources.map(async source => {
            const sourceResponse = await fetch(source);
            if (!sourceResponse.ok) throw new Error(`${source}: ${sourceResponse.status}`);
            return sourceResponse.json();
        }));

        return {
            title: indexData.title,
            events: sourceEvents.flat()
        };
    } catch (error) {
        console.warn("分割データの読み込みに失敗したため、TMdata.jsonを読み込みます。", error);
        const response = await fetch('TMdata.json');
        return response.json();
    }
}

// 届いたバラバラなデータを、年表が読み込める「きれいな形」に整える関数です
function normalizeTimelineData(data) {
    const usedIds = new Set();

    // 今日の日付を取得して TimelineJS 形式に整える
    const now = new Date();
    const today = {
        year: now.getFullYear().toString(),
        month: (now.getMonth() + 1).toString(),
        day: now.getDate().toString()
    };

    data.events = data.events.map((event, index) => {
        const normalized = { ...event };

        // 文章が空っぽでもエラーにならないように空文字を入れておきます
        normalized.text = {
            headline: "",
            text: "",
            ...(normalized.text || {})
        };

        // 終了日に "ongoing" が入っていたら今日の日付に差し替える
        if (normalized.end_date === "ongoing") {
            normalized.end_date = today;
        }

        // 各イベントに「重複しない番号（ID）」を割り振ります
        if (!normalized.unique_id) {
            normalized.unique_id = normalized.id || makeEventId(normalized, index);
        }

        if (!normalized.id) {
            normalized.id = normalized.unique_id;
        }

        // シリーズ名やメディア種別がない場合に「その他」として分類します
        normalized.custom_tags = {
            media: "Other",
            series: "Other",
            project_id: "other_cluster",
            type: normalized.parent_id ? "volume_dot" : "series_bar", // 親か子かを判定
            ...(normalized.custom_tags || {})
        };

        // 万が一IDが被ったら、お尻に数字をつけて無理やり別物に分けます
        if (usedIds.has(normalized.unique_id)) {
            normalized.unique_id = `${normalized.unique_id}_${index}`;
            normalized.id = normalized.unique_id;
        }

        usedIds.add(normalized.unique_id);
        return normalized;
    });

    // 「親」になっている項目に、特別なマーク（series_bar）をつけます
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

// イベントのタイトルなどから、コンピュータ用の短いIDを自動生成します
function makeEventId(event, index) {
    const headline = event.text && event.text.headline ? event.text.headline : `event_${index}`;
    return headline
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^\w-]/g, "") || `event_${index}`;
}

// --- 画面操作（ボタンなど）の処理 ---

// 画面にある「絞り込みチェックボックス」の中身を自動で作り上げます
function buildFilterControls() {
    buildCheckboxGroup('media-filters', 'filter-media', uniqueValues('media'));
    buildCheckboxGroup('series-filters', 'filter-series', uniqueValues('series'));
    buildCheckboxGroup('project-filters', 'filter-project', uniqueValues('project_id'));
}

// 指定された場所（コンテナ）に、チェックボックスの塊を作成します
function buildCheckboxGroup(containerId, className, values) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    values.forEach(value => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = className;
        checkbox.value = value;
        checkbox.checked = true; // 最初は全部チェック入り
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${displayFilterName(value)}`));
        container.appendChild(label);
    });
}

// 全データの中から、重複なしでカテゴリ名（シリーズ名など）を抜き出します
function uniqueValues(key) {
    return [...new Set(masterData.events.map(ev => ev.custom_tags[key]).filter(Boolean))].sort();
}

// 英語のカテゴリ名を、画面表示用の日本語に翻訳します
function displayFilterName(value) {
    const names = {
        staynight: "Fate/stay nightシリーズ",
        Anime: "アニメ",
        Game: "ゲーム",
        Comic: "漫画",
        Other: "その他",
        Tsukihime: "月姫"
    };
    return names[value] || value;
}

// 「プロジェクトごと」「メディアごと」など、年表の行の分け方を決める関数です
function getGroupName(event, mode) {
    if (mode === 'media') return event.custom_tags.media;
    const pid = event.custom_tags.project_id;
    return projectNames[pid] || pid;
}

// --- 年表の更新・描画処理 ---

// 今の検索ワードやチェック状態を見て、年表を新しく作り直す「司令塔」です
function updateTimeline() {
    if (!masterData) return;

    // 現在のユーザーの入力（検索・チェック）を取得します
    const searchText = document.getElementById('search-input').value.toLowerCase();
    const selectedSeries = Array.from(document.querySelectorAll('.filter-series:checked')).map(el => el.value);
    const selectedMedia = Array.from(document.querySelectorAll('.filter-media:checked')).map(el => el.value);
    const selectedProjects = Array.from(document.querySelectorAll('.filter-project:checked')).map(el => el.value);
    const groupMode = document.querySelector('input[name="group-mode"]:checked').value;

    // まずは「メインとなる項目（親）」を選び出します
    const parents = masterData.events.filter(ev => {
        const isSeriesBar = ev.custom_tags.type === 'series_bar';
        return isSeriesBar && matchesFilters(ev, searchText, selectedSeries, selectedMedia, selectedProjects);
    });

    // 親→その親の詳細→次の親、の順に並べることで、詳細グループが親の直後に出やすくします
    currentDisplayedEvents = [];

    parents.forEach(parent => {
        currentDisplayedEvents.push({
            ...parent,
            group: getGroupName(parent, groupMode)
        });

        if (!expandedParentIds.has(parent.unique_id)) return;

        // 子データは親の unique_id をグループ名にして、親専用の詳細行にまとめます
        const detailGroupName = getDetailGroupName(parent);
        const details = masterData.events
            .filter(child => child.parent_id === parent.unique_id)
            .filter(child => matchesFilters(child, searchText, selectedSeries, selectedMedia, selectedProjects))
            .map(child => ({
                ...child,
                group: detailGroupName
            }));

        currentDisplayedEvents.push(...details);
    });

    render(currentDisplayedEvents, pendingSlideId);
}

// 詳細グループ名は表示名ではなく親の unique_id を使い、データ上の親子関係と一致させます
function getDetailGroupName(parent) {
    return parent.unique_id;
}

// あるイベントが、検索条件やメディア/シリーズ/プロジェクトのチェック状態に合格しているか判定します
function matchesFilters(event, searchText, selectedSeries, selectedMedia, selectedProjects) {
    const headline = event.text && event.text.headline ? event.text.headline.toLowerCase() : "";
    const body = event.text && event.text.text ? event.text.text.toLowerCase() : "";
    
    const matchesSearch = !searchText || headline.includes(searchText) || body.includes(searchText);
    const matchesSeries = selectedSeries.includes(event.custom_tags.series);
    const matchesMedia = selectedMedia.includes(event.custom_tags.media);
    const matchesProject = selectedProjects.includes(event.custom_tags.project_id);
    
    return matchesSearch && matchesSeries && matchesMedia && matchesProject;
}

// 実際にHTMLの中に年表を書き込みます
function render(events, slideIdToRestore) {
    const data = { ...masterData, events: events };
    const container = document.getElementById("timeline-embed");
    container.style.height = `${timelineHeight}px`;
    container.innerHTML = ""; // 一旦まっさらにする
    
    timeline = new TL.Timeline("timeline-embed", data, getTimelineOptions());

    // 年表が完成した後の仕上げ処理です
    timeline.on('loaded', () => {
        // もし直前に見ていたスライドがあれば、そこへ移動します
        if (slideIdToRestore && currentDisplayedEvents.some(ev => ev.unique_id === slideIdToRestore)) {
            timeline.goToId(slideIdToRestore);
            pendingSlideId = null;
        }
        tagChildDetailMarkers(); // 詳細ドットに見た目用の印をつける
        applyMarkerColors(); // 親は背景色、子は文字色だけを変える
    });

    // スライドが切り替わった時の動きを監視します
    timeline.on('change', handleTimelineChange);
}

//現在の縦幅から、上画面を450pxに保つための比率を逆算する
function getTimelineOptions() {
    // 全体の高さから450pxを引いた残りが「下画面」の占めるべき割合
    let navPercentage = ((timelineHeight - FIXED_SLIDE_HEIGHT) / timelineHeight) * 100;

    // 極端な数値にならないよう、20%〜85%の間に収める（安全策）
    navPercentage = Math.min(Math.max(navPercentage, 20), 85);

    return {
        ...timelineOptions,
        timenav_height_percentage: navPercentage,
        timenav_height_min: timenavHeightMin
    };
}

// 詳細用の小さなドット（マーカー）に、CSSで色などを変えるためのクラスをつけます
function tagChildDetailMarkers() {
    currentDisplayedEvents.forEach(event => {
        const marker = document.getElementById(`${event.unique_id}-marker`);
        if (!marker) return;

        marker.classList.toggle('tm-child-detail-marker', Boolean(event.parent_id));
    });
}

// custom_tags.color → project_id由来の色 → グレー、の順で色を決めてマーカーへ反映します
function applyMarkerColors() {
    currentDisplayedEvents.forEach(event => {
        const marker = document.getElementById(`${event.unique_id}-marker`);
        if (!marker) return;

        // 【重要】CSS側に現在の「最小高さ(36px)」を伝える
        marker.style.setProperty("--tm-marker-fixed-height", `${timelineOptions.marker_height_min}px`);

        const color = getMarkerColor(event);
        marker.style.setProperty("--tm-marker-color", color);
        marker.style.setProperty("--tm-marker-text-color", getReadableTextColor(color));
        marker.classList.toggle("tm-parent-colored-marker", !event.parent_id);

        if (event.parent_id) {
            applyChildMarkerColor(marker, color);
        } else {
            applyParentMarkerColor(marker, color);
        }
    });
}

function getMarkerColor(event) {
    const tags = event.custom_tags || {};
    if (tags.color) return tags.color;
    if (tags.project_id) return getProjectColor(tags.project_id);
    return fallbackMarkerColor;
}

function getProjectColor(projectId) {
    return projectColors[projectId] || fallbackMarkerColor;
}

function getReadableTextColor(color) {
    const hex = color.replace("#", "");
    if (hex.length !== 6) return "#ffffff";

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    return luminance > 150 ? "#222222" : "#ffffff";
}

function applyParentMarkerColor(marker, color) {
    const textColor = getReadableTextColor(color);
    const coloredParts = [
        marker.querySelector(".tl-timemarker-content-container"),
        marker.querySelector(".tl-timemarker-timespan"),
        marker.querySelector(".tl-timemarker-timespan-content")
    ];

    coloredParts.forEach(part => {
        if (!part) return;
        part.style.backgroundColor = color;
        part.style.borderColor = color;
        part.style.color = textColor;
    });

    const content = marker.querySelector(".tl-timemarker-content");
    if (content) {
        content.style.color = textColor;
    }
}

function applyChildMarkerColor(marker, color) {
    const content = marker.querySelector(".tl-timemarker-content");
    const headline = marker.querySelector(".tl-headline");

    if (content) {
        content.style.color = color;
    }
    if (headline) {
        headline.style.color = color;
    }
}

// ユーザーがスライドを切り替えた時の処理です
function handleTimelineChange() {
    const slide = timeline.getCurrentSlide();
    const slideData = slide && slide.data;

    if (!slideData || !slideData.unique_id) {
        return;
    }

    // もし「親」の項目が選ばれたら、隠れていた「詳細（子）」を自動でパッと広げます
    if (slideData.custom_tags && slideData.custom_tags.type === 'series_bar') {
        const details = masterData.events.filter(ev => ev.parent_id === slideData.unique_id);
        if (details.length > 0 && !expandedParentIds.has(slideData.unique_id)) {
            expandedParentIds.add(slideData.unique_id);
            pendingSlideId = slideData.unique_id; // 再描画しても今の場所を忘れないようにメモ
            updateTimeline();
        }
    }
}

// 広がっている詳細を全部閉じて、最初のスッキリした状態に戻します
function collapseDetails() {
    expandedParentIds.clear();
    pendingSlideId = null;
    updateTimeline();
}

// ボタンを押すたびに表示領域と時間軸の縦幅を増やして、同じ表示内容で描き直します
function increaseTimelineHeight() {
    timelineHeight += heightIncreaseStep;
    timenavHeightMin += timenavIncreaseStep;

    rerenderTimelineAtCurrentSlide();
}

// 広げた分を同じ段階で戻します。基準値より小さくはしません
function decreaseTimelineHeight() {
    timelineHeight = Math.max(baseTimelineHeight, timelineHeight - heightIncreaseStep);
    timenavHeightMin = Math.max(baseTimenavHeightMin, timenavHeightMin - timenavIncreaseStep);

    rerenderTimelineAtCurrentSlide();
}

// 高さだけを変えた後、現在見ているスライドをなるべく維持して描き直します
function rerenderTimelineAtCurrentSlide() {
    const currentSlide = timeline && timeline.getCurrentSlide ? timeline.getCurrentSlide() : null;
    const currentId = currentSlide && currentSlide.data ? currentSlide.data.unique_id : pendingSlideId;
    render(currentDisplayedEvents, currentId);
}

// --- 最後の仕上げ：ボタンと機能を紐付ける ---

// ページが読み込まれたらスタート！
document.addEventListener('DOMContentLoaded', initApp);
// 「フィルター適用」ボタンを押したら更新！
document.getElementById('apply-filters').addEventListener('click', updateTimeline);
// 「縦に広げる」ボタンを押したら、年表の表示領域を少しずつ伸ばします
document.getElementById('increase-height').addEventListener('click', increaseTimelineHeight);
// 「縦に縮める」ボタンを押したら、広げた分を同じ段階で戻します
document.getElementById('decrease-height').addEventListener('click', decreaseTimelineHeight);
// 「詳細を閉じる」ボタンを押したらリセット！
document.getElementById('collapse-details').addEventListener('click', collapseDetails);

