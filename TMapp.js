// --- 設定・準備エリア ---

// プロジェクトのID（短い名前）を、画面に表示するための正式名称に変換する辞書です
const projectNames = {
    "fsn_cluster": "Fate/stay night Project",
    "tsuki_cluster": "真月譚 月姫 Project",
    "knk_cluster": "空の境界 Project"
};

// 年表（TimelineJS）の見た目や動きを細かく決める設定値です
const timelineOptions = {
    language: "ja",                   // 日本語表示
    initial_zoom: 2,                  // 最初のズーム倍率
    timenav_height_percentage: 55,    // 下側の年表ナビの高さ（％）
    timenav_height_min: 560,          // 最小の高さ（ピクセル）
    marker_height_min: 36,            // マーカーの最小の高さ
    marker_width_min: 140,            // マーカーの最小の幅
    marker_padding: 8                 // マーカー同士の隙間
};

// アプリ全体で使う「作業用ポケット（変数）」です
let masterData = null;                // 読み込んだ全てのデータ
let currentDisplayedEvents = [];      // 今、画面に表示しているデータ
let timeline = null;                  // 作成された年表本体
let expandedParentIds = new Set();    // 今、詳細が開かれている項目のリスト
let pendingSlideId = null;            // 次に表示したいスライドの予約番号

// --- アプリ起動の処理 ---

// アプリの「起動スイッチ」です。データを読み込んで準備を始めます
async function initApp() {
    try {
        // 外部ファイル（TMdata.json）からデータを取ってきます
        const response = await fetch('TMdata.json');
        // 届いたデータを使いやすいように「下準備（normalize）」して保存します
        masterData = normalizeTimelineData(await response.json());
        // 画面に「絞り込みボタン」を作ります
        buildFilterControls();
        // 準備ができたので年表を画面に描きます
        updateTimeline();
    } catch (error) {
        console.error("データの読み込みに失敗しました:", error);
    }
}

// 届いたバラバラなデータを、年表が読み込める「きれいな形」に整える関数です
function normalizeTimelineData(data) {
    const usedIds = new Set();

    data.events = data.events.map((event, index) => {
        const normalized = { ...event };

        // 文章が空っぽでもエラーにならないように空文字を入れておきます
        normalized.text = {
            headline: "",
            text: "",
            ...(normalized.text || {})
        };

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
    buildCheckboxGroup('series-filters', 'filter-series', uniqueValues('series'));
    buildCheckboxGroup('media-filters', 'filter-media', uniqueValues('media'));
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
        Anime: "アニメ",
        Game: "ゲーム",
        Manga: "漫画",
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
    const groupMode = document.querySelector('input[name="group-mode"]:checked').value;

    // まずは「メインとなる項目（親）」を選び出します
    const parents = masterData.events.filter(ev => {
        const isSeriesBar = ev.custom_tags.type === 'series_bar';
        return isSeriesBar && matchesFilters(ev, searchText, selectedSeries, selectedMedia);
    });

    // 「展開ボタン」が押されている項目の「詳細（子）」を選び出します
    const visibleParentIds = new Set(parents.map(ev => ev.unique_id));
    const details = masterData.events.filter(ev => {
        if (!ev.parent_id || !expandedParentIds.has(ev.parent_id)) return false;
        if (!visibleParentIds.has(ev.parent_id)) return false;
        return matchesFilters(ev, searchText, selectedSeries, selectedMedia);
    });

    // 表示するものが決まったので、グループ名をセットして表示準備完了です
    currentDisplayedEvents = [...parents, ...details].map(ev => ({
        ...ev,
        group: getGroupName(ev, groupMode)
    }));

    render(currentDisplayedEvents, pendingSlideId);
}

// あるイベントが、検索条件やチェックボックスに合格しているか判定します
function matchesFilters(event, searchText, selectedSeries, selectedMedia) {
    const headline = event.text && event.text.headline ? event.text.headline.toLowerCase() : "";
    const body = event.text && event.text.text ? event.text.text.toLowerCase() : "";
    
    const matchesSearch = !searchText || headline.includes(searchText) || body.includes(searchText);
    const matchesSeries = selectedSeries.includes(event.custom_tags.series);
    const matchesMedia = selectedMedia.includes(event.custom_tags.media);
    
    return matchesSearch && matchesSeries && matchesMedia;
}

// 実際にHTMLの中に年表を書き込みます
function render(events, slideIdToRestore) {
    const data = { ...masterData, events: events };
    document.getElementById("timeline-embed").innerHTML = ""; // 一旦まっさらにする
    
    timeline = new TL.Timeline("timeline-embed", data, timelineOptions);

    // 年表が完成した後の仕上げ処理です
    timeline.on('loaded', () => {
        // もし直前に見ていたスライドがあれば、そこへ移動します
        if (slideIdToRestore && currentDisplayedEvents.some(ev => ev.unique_id === slideIdToRestore)) {
            timeline.goToId(slideIdToRestore);
            pendingSlideId = null;
        }
        tagChildDetailMarkers(); // 詳細ドットに見た目用の印をつける
    });

    // スライドが切り替わった時の動きを監視します
    timeline.on('change', handleTimelineChange);
}

// 詳細用の小さなドット（マーカー）に、CSSで色などを変えるためのクラスをつけます
function tagChildDetailMarkers() {
    currentDisplayedEvents.forEach(event => {
        const marker = document.getElementById(`${event.unique_id}-marker`);
        if (!marker) return;

        marker.classList.toggle('tm-child-detail-marker', Boolean(event.parent_id));
    });
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

// --- 最後の仕上げ：ボタンと機能を紐付ける ---

// ページが読み込まれたらスタート！
document.addEventListener('DOMContentLoaded', initApp);
// 「フィルター適用」ボタンを押したら更新！
document.getElementById('apply-filters').addEventListener('click', updateTimeline);
// 「詳細を閉じる」ボタンを押したらリセット！
document.getElementById('collapse-details').addEventListener('click', collapseDetails);
