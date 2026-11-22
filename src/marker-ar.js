// 印刷したマーカーの上に立体を表示する AR（A-Frame + AR.js）。
// 必要になったときに CDN から読みこむ（ふだんの読みこみを軽くするため）。
//
// シーンは最初に開いたときに1回だけ作り、閉じたら止めて隠し、次に開くときに使い回す。
// AR.js はシーンごとに window へイベントを登録して消さないため、作り直すと古いシーンも
// 動き出して認識がおかしくなる（2回目以降マーカーを見つけられないことがある）。
const AFRAME_URL = 'https://cdn.jsdelivr.net/npm/aframe@1.7.1/dist/aframe-v1.7.1.min.js';
const ARJS_URL = 'https://cdn.jsdelivr.net/npm/@ar-js-org/ar.js@3.4.8/aframe/build/aframe-ar.js';

// カメラ補正データ（AR.js 同梱の camera_para.dat を埋め込み。ardata/camera_para.dat と同じもの）
const CAM_PARA_B64 =
  'AAACgAAAAeBAgwrsW6bUSwAAAAAAAAAAQHQ3KqAAAAAAAAAAAAAAAAAAAAAAAAAAQIL0K3dHyf9AbbNowAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAAAAAAAA/uWNa4AAAAL+3lTLAAAAAv17YFWAAAAA/VYLXIAAAAECCe0YgAAAAQIJlMOAAAABAdDcqoAAAAEBts2jAAAAAP+8OmzqkDy4=';
let camParaUrl = null;
const getCamParaUrl = () =>
  camParaUrl ||
  (camParaUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(CAM_PARA_B64), c => c.charCodeAt(0))])));

const loadScript = src =>
  new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('読み込み失敗: ' + src));
    document.head.appendChild(s);
  });

const $ = id => document.getElementById(id);
let scene = null,
  modelUrl = null,
  cameraConstraints = null,
  pageState = null;
const setMsg = text => {
  $('arMsg').textContent = text;
};
const arVideo = () => document.getElementById('arjs-video');
const isOpen = () => document.body.classList.contains('ar-on');
function stopCamera() {
  const video = arVideo();
  video?.srcObject?.getTracks().forEach(t => t.stop());
  if (video) video.srcObject = null;
}

// glb: 表示する立体（Blob）
export async function startMarkerAR(glb) {
  const view = $('arView');
  view.hidden = false;
  document.body.classList.add('ar-on');
  setMsg('カメラを起動しています…');
  try {
    await loadScript(AFRAME_URL);
    await loadScript(ARJS_URL);
  } catch (e) {
    setMsg('ARの部品を読み込めませんでした。ネットにつながっているか確認してください。');
    return;
  }
  if (modelUrl) URL.revokeObjectURL(modelUrl);
  modelUrl = URL.createObjectURL(glb);
  if (!scene) createScene(view);
  else await resumeScene();
}

function createScene(view) {
  const base = new URL('ardata/', location.href).href;
  // device-orientation-permission-ui は切る（マーカーARでは傾きセンサーを使わない。iPad で許可ダイアログが「閉じる」をふさぐのを防ぐ）
  view.insertAdjacentHTML(
    'beforeend',
    `<a-scene id="arScene" embedded vr-mode-ui="enabled:false" device-orientation-permission-ui="enabled:false" renderer="logarithmicDepthBuffer:true;antialias:true" loading-screen="enabled:false"
    arjs="sourceType:webcam;debugUIEnabled:false;detectionMode:mono;cameraParametersUrl:${getCamParaUrl()}${window.__arSource || ''}">
    <a-entity light="type:ambient;intensity:1.4"></a-entity><a-entity light="type:directional;intensity:2.6" position="1 3 2"></a-entity>
    <a-marker id="arMarker" type="pattern" url="${base}oka.patt" smooth="true" smoothCount="5">
      <a-entity id="arModel" gltf-model="url(${modelUrl})" scale="8 8 8"></a-entity>
    </a-marker>
    <a-entity camera></a-entity></a-scene>`,
  );
  scene = $('arScene');
  setMsg('印刷したマーカーにカメラを向けてください');
  const mk = $('arMarker');
  mk.addEventListener('markerFound', () => {
    setMsg('マーカーを認識しました');
    window.__markerFound = true;
  });
  mk.addEventListener('markerLost', () => {
    setMsg('マーカーを探しています…');
  });
  window.addEventListener(
    'arjs-video-loaded',
    () => {
      window.__arVideo = true;
      cameraConstraints = arVideo()?.srcObject?.getVideoTracks()[0]?.getConstraints() || null;
      if (!isOpen()) stopCamera(); // カメラの起動前に閉じられていた
    },
    { once: true },
  );
  window.addEventListener('camera-error', () => {
    setMsg('カメラを使えませんでした。ブラウザのカメラ許可を確認してください。');
  });
}

// 2回目以降: 立体を差しかえ、カメラをつなぎ直して再開する
async function resumeScene() {
  if (pageState) {
    document.documentElement.className = pageState.htmlClass;
    document.body.style.cssText = pageState.bodyStyle;
  }
  $('arModel').setAttribute('gltf-model', `url(${modelUrl})`);
  $('arMarker').object3D.visible = false; // 見つけ直したときに markerFound が出るように
  const video = arVideo();
  if (video && cameraConstraints) {
    try {
      video.srcObject = await navigator.mediaDevices.getUserMedia({ audio: false, video: cameraConstraints });
      await video.play();
    } catch (e) {
      setMsg('カメラを使えませんでした。ブラウザのカメラ許可を確認してください。');
      return;
    }
  }
  scene.renderer.setAnimationLoop(scene.render);
  scene.play();
  setMsg('印刷したマーカーにカメラを向けてください');
}

export function stopMarkerAR() {
  if (scene) {
    try {
      scene.pause();
      scene.renderer?.setAnimationLoop(null);
    } catch {}
    stopCamera();
  }
  // A-Frame・AR.js がページ全体に付けたクラスとスタイルを外す（次に開くときに戻す）
  if (scene) pageState = { htmlClass: document.documentElement.className, bodyStyle: document.body.style.cssText };
  $('arView').hidden = true;
  document.body.classList.remove('ar-on');
  document.documentElement.removeAttribute('class');
  document.body.style.cssText = '';
}
