/**
 * LABIT - 프론트엔드 통합 메인 컨트롤러
 * (PWA, OAuth 인증, SPA 라우터, DB 연결 대시보드 및 실험 관리 전체 구현)
 */

// 전역 안전 가드 헬퍼
function safeConfig() {
  return window.CONFIG || (typeof CONFIG !== 'undefined' ? CONFIG : { GAS_API_URL: '', GOOGLE_CLIENT_ID: '', ALLOWED_DOMAIN: 'yanggok.hs.kr' });
}

function safeMenuItems() {
  return window.MENU_ITEMS || (typeof MENU_ITEMS !== 'undefined' ? MENU_ITEMS : []);
}

// ==========================================
// 1. Google 계정 인증 및 세션 제어 모듈 (Auth)
// ==========================================
const Auth = (() => {
  let currentUser = null;
  const SESSION_KEY = 'labit_session_token';
  const USER_KEY = 'labit_user_info';

  async function init() {
    loadSavedSession();
    initGoogleGIS();
    await verifyExistingSession();
    bindEvents();
    updateUserUI();
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const loginBtn = e.target.closest('#auth-btn');
      if (loginBtn && !currentUser) {
        e.preventDefault();
        openLoginModal();
        return;
      }

      const closeBtn = e.target.closest('#modal-close-btn');
      if (closeBtn) {
        e.preventDefault();
        closeLoginModal();
        return;
      }

      const modal = document.getElementById('login-modal');
      if (modal && e.target === modal) {
        closeLoginModal();
      }
    });
  }

  function loadSavedSession() {
    // 브라우저에 저장된 사용자 정보만으로 로그인 상태를 인정하지 않는다.
    // 서버 세션 검증이 성공한 경우에만 currentUser를 설정한다.
    if (!localStorage.getItem(SESSION_KEY)) {
      localStorage.removeItem(USER_KEY);
    }
    currentUser = null;
  }

  function initGoogleGIS() {
    const cfg = safeConfig();
    if (!cfg.GOOGLE_CLIENT_ID || cfg.GOOGLE_CLIENT_ID.trim() === '') return;

    if (window.google && window.google.accounts) {
      window.google.accounts.id.initialize({
        client_id: cfg.GOOGLE_CLIENT_ID.trim(),
        callback: handleCredentialResponse,
        hosted_domain: cfg.ALLOWED_DOMAIN || 'yanggok.hs.kr',
        auto_select: false
      });
    }
  }

  function openLoginModal() {
    const modal = document.getElementById('login-modal');
    const errEl = document.getElementById('login-error-msg');
    if (errEl) errEl.classList.add('hidden');

    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }

    const cfg = safeConfig();
    if (!cfg.GOOGLE_CLIENT_ID || cfg.GOOGLE_CLIENT_ID.trim() === '') {
      showLoginError('Google Client ID가 설정되지 않았습니다. [관리자 설정] 메뉴에서 먼저 등록해 주세요.');
      return;
    }

    if (window.google && window.google.accounts) {
      initGoogleGIS();
      const btnContainer = document.getElementById('g_id_onload_button');
      if (btnContainer) {
        btnContainer.innerHTML = '';
        window.google.accounts.id.renderButton(
          btnContainer,
          { theme: 'outline', size: 'large', width: 280, text: 'signin_with', shape: 'pill' }
        );
      }
    } else {
      showLoginError('Google 로그인 SDK를 로드할 수 없습니다.');
    }
  }

  function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  async function handleCredentialResponse(response) {
    if (!response || !response.credential) {
      showLoginError('Google 로그인 자격 증명을 취득하지 못했습니다.');
      return;
    }

    const idToken = response.credential;
    showLoginLoading(true);

    try {
      const result = await API.post('auth/verifyToken', { idToken: idToken });

      if (result.success && result.data) {
        currentUser = result.data.user;
        const sessionToken = result.data.sessionToken;

        localStorage.setItem(SESSION_KEY, sessionToken);
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));

        updateUserUI();
        closeLoginModal();
        
        if (window.navigateTo) window.navigateTo('dashboard');
      } else {
        showLoginError(result.message || '인증 검증에 실패했습니다.');
      }
    } catch (err) {
      showLoginError('서버 인증 처리 중 오류가 발생했습니다: ' + err.message);
    } finally {
      showLoginLoading(false);
    }
  }

  async function verifyExistingSession() {
    const cfg = safeConfig();
    const sessionToken = localStorage.getItem(SESSION_KEY);
    if (!sessionToken || !cfg.GAS_API_URL) return;

    try {
      const result = await API.post('auth/checkSession', { sessionToken: sessionToken });
      if (result.success && result.data && result.data.valid) {
        currentUser = result.data.user;
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      } else {
        logout(false);
      }
    } catch (e) {
      console.warn('[LABIT Auth] 세션 재검증 실패:', e);
    } finally {
      updateUserUI();
    }
  }

  function logout(userInitiated = true) {
    const cfg = safeConfig();
    const sessionToken = localStorage.getItem(SESSION_KEY);
    if (sessionToken && cfg.GAS_API_URL && userInitiated) {
      API.post('auth/logout', { sessionToken: sessionToken }).catch(() => {});
    }

    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_KEY);

    updateUserUI();

    if (userInitiated && window.navigateTo) {
      window.navigateTo('dashboard');
    }
  }

  function updateUserUI() {
    const displayNameEl = document.getElementById('user-display-name');
    const statusTextEl = document.getElementById('user-status-text');
    const roleBadgeEl = document.getElementById('user-role-badge');
    const avatarContainer = document.getElementById('user-avatar-container');
    const authBtnContainer = document.getElementById('auth-btn-container');

    if (currentUser) {
      if (displayNameEl) displayNameEl.textContent = currentUser.name;
      if (statusTextEl) statusTextEl.textContent = currentUser.email;

      if (roleBadgeEl) {
        roleBadgeEl.textContent = currentUser.role;
        roleBadgeEl.className = `px-1.5 py-0.5 text-[10px] font-bold rounded uppercase ${
          currentUser.role === 'ADMIN' ? 'badge-admin' : 'badge-member'
        }`;
      }

      if (avatarContainer) {
        if (currentUser.picture) {
          avatarContainer.innerHTML = `<img src="${currentUser.picture}" alt="Profile" class="w-full h-full object-cover">`;
        } else {
          const initials = currentUser.name ? currentUser.name.substring(0, 2) : 'YG';
          avatarContainer.innerHTML = `<span>${initials}</span>`;
        }
      }

      if (authBtnContainer) {
        authBtnContainer.innerHTML = `
          <button onclick="Auth.logout()" class="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all shadow-xs flex items-center space-x-1 cursor-pointer">
            <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
            <span>로그아웃</span>
          </button>
        `;
      }
    } else {
      if (displayNameEl) displayNameEl.textContent = '게스트';
      if (statusTextEl) statusTextEl.textContent = '로그인이 필요합니다';
      
      if (roleBadgeEl) {
        roleBadgeEl.textContent = 'GUEST';
        roleBadgeEl.className = 'px-1.5 py-0.5 text-[10px] font-bold rounded uppercase badge-guest';
      }

      if (avatarContainer) avatarContainer.innerHTML = `<span>YG</span>`;

      if (authBtnContainer) {
        authBtnContainer.innerHTML = `
          <button id="auth-btn" class="px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-labit-primary to-emerald-600 hover:from-emerald-600 hover:to-teal-700 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-95 flex items-center space-x-1.5 cursor-pointer">
            <i data-lucide="log-in" class="w-4 h-4"></i>
            <span>로그인</span>
          </button>
        `;
      }
    }

    if (window.lucide) lucide.createIcons();
  }

  function showLoginError(msg) {
    const errEl = document.getElementById('login-error-msg');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }

  function showLoginLoading(isLoading) {
    const btnContainer = document.getElementById('g_id_onload_button');
    if (!btnContainer) return;

    if (isLoading) {
      btnContainer.innerHTML = `
        <div class="flex items-center space-x-2 text-xs font-semibold text-labit-primary py-3">
          <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
          <span>서버 토큰 검증 중...</span>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    }
  }

  function getUser() { return currentUser; }
  function getUserRole() { return currentUser ? currentUser.role : 'GUEST'; }

  return {
    init: init,
    openLoginModal: openLoginModal,
    closeLoginModal: closeLoginModal,
    logout: logout,
    getUser: getUser,
    getUserRole: getUserRole,
    initGoogleGIS: initGoogleGIS
  };
})();

window.Auth = Auth;


// ==========================================
// 2. SPA 라우터 및 상태 관리 메인 로직
// ==========================================
let currentMenuId = 'dashboard';
let deferredInstallPrompt = null;
let experimentsDataCache = [];
let experimentDetailCache = null;

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  initPWA();
});

async function initApp() {
  initNetworkListeners();
  await Auth.init();
  renderSidebarNav();
  renderMobileNav();
  navigateTo('dashboard');
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      installBtn.classList.remove('hidden');
      installBtn.classList.add('flex');
      installBtn.addEventListener('click', () => {
        if (deferredInstallPrompt) deferredInstallPrompt.prompt();
      });
    }
  });
}

function initNetworkListeners() {
  const updateNetworkStatus = () => {
    const statusBar = document.getElementById('network-status-bar');
    if (!statusBar) return;
    if (navigator.onLine) statusBar.classList.add('hidden');
    else statusBar.classList.remove('hidden');
  };
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();
}

function getRoleLevel(role) {
  if (role === 'ADMIN') return 2;
  if (role === 'MEMBER') return 1;
  return 0;
}

function canAccessMenu(item) {
  const userRole = Auth.getUserRole();
  const userLevel = getRoleLevel(userRole);
  const requiredLevel = getRoleLevel(item.minRole);
  return userLevel >= requiredLevel;
}

function renderSidebarNav() {
  const sidebarNav = document.getElementById('sidebar-nav');
  if (!sidebarNav) return;

  const items = safeMenuItems();
  sidebarNav.innerHTML = items.map(item => {
    const accessible = canAccessMenu(item);
    const isLocked = !accessible;

    return `
      <button 
        onclick="navigateTo('${item.id}')" 
        id="nav-btn-${item.id}"
        class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
          isLocked 
            ? 'text-slate-400 opacity-60 hover:bg-slate-50 cursor-not-allowed' 
            : 'text-labit-subtext hover:bg-slate-100 hover:text-labit-text'
        }">
        <div class="flex items-center space-x-3">
          <i data-lucide="${item.icon}" class="w-4 h-4"></i>
          <span>${item.name}</span>
        </div>
        ${isLocked ? '<i data-lucide="lock" class="w-3.5 h-3.5 text-slate-400"></i>' : ''}
      </button>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function renderMobileNav() {
  const mobileNav = document.getElementById('mobile-bottom-nav');
  if (!mobileNav) return;

  const items = safeMenuItems().slice(0, 5);
  mobileNav.innerHTML = items.map(item => `
    <button 
      onclick="navigateTo('${item.id}')" 
      id="mobile-nav-btn-${item.id}"
      class="flex flex-col items-center justify-center py-1 px-2 text-labit-subtext hover:text-labit-primary transition-colors flex-1">
      <i data-lucide="${item.icon}" class="w-5 h-5"></i>
      <span class="text-[10px] mt-1 font-medium truncate w-full text-center">${item.name}</span>
    </button>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function navigateTo(menuId) {
  const items = safeMenuItems();
  const menuItem = items.find(m => m.id === menuId);
  if (!menuItem) return;

  if (!canAccessMenu(menuItem)) {
    Auth.openLoginModal();
    return;
  }

  currentMenuId = menuId;
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = menuItem.name;

  items.forEach(item => {
    const btn = document.getElementById(`nav-btn-${item.id}`);
    if (btn) {
      if (item.id === menuId) btn.classList.add('nav-item-active');
      else btn.classList.remove('nav-item-active');
    }

    const mBtn = document.getElementById(`mobile-nav-btn-${item.id}`);
    if (mBtn) {
      if (item.id === menuId) mBtn.classList.add('mobile-nav-active');
      else mBtn.classList.remove('mobile-nav-active');
    }
  });

  renderView(menuItem);
  if (window.lucide) lucide.createIcons();
}

function renderView(menuItem) {
  const contentEl = document.getElementById('app-content');
  if (!contentEl) return;

  if (menuItem.id === 'dashboard') {
    renderDashboardView(contentEl);
  } else if (menuItem.id === 'experiments') {
    renderExperimentsView(contentEl);
  } else if (menuItem.id === 'admin') {
    contentEl.innerHTML = getAdminTestViewHTML();
  } else {
    contentEl.innerHTML = getPlaceholderViewHTML(menuItem);
  }
}


// ==========================================
// 3. DB 연동 대시보드 뷰 구현
// ==========================================
async function renderDashboardView(container) {
  container.innerHTML = `
    <div class="flex items-center justify-center py-16">
      <div class="flex items-center space-x-3 text-labit-primary font-bold">
        <i data-lucide="loader-2" class="w-6 h-6 animate-spin"></i>
        <span>실시간 데이터베이스 대시보드 불러오는 중...</span>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();

  let summary = {
    totalExperiments: 0,
    inProgressExperiments: 0,
    completedExperiments: 0,
    materialsCount: 0,
    schedulesCount: 0,
    activitiesCount: 0,
    recentMaterials: [],
    upcomingSchedules: [],
    recentActivities: [],
    recentPosts: []
  };

  try {
    const res = await API.post('dashboard/getSummary');
    if (res.success && res.data) {
      summary = res.data;
    }
  } catch (e) {
    console.warn('[Dashboard] 통계 불러오기 실패:', e);
  }

  const user = Auth.getUser();
  const userName = user ? user.name : '동아리원';

  container.innerHTML = `
    <div class="space-y-6">
      <div class="p-6 rounded-2xl bg-gradient-to-r from-labit-primary via-emerald-600 to-teal-700 text-white shadow-lg">
        <div class="max-w-2xl">
          <span class="px-3 py-1 bg-white/20 text-white rounded-full text-xs font-semibold backdrop-blur-md inline-flex items-center space-x-1">
            <span class="w-2 h-2 bg-emerald-300 rounded-full animate-ping mr-1"></span>
            6단계 실시간 데이터베이스 연동됨
          </span>
          <h3 class="text-2xl font-bold mt-3 tracking-tight">반갑습니다, ${userName}님!</h3>
          <p class="text-emerald-100 text-sm mt-1 leading-relaxed">LABIT 의생명과학 동아리 통합 데이터 플랫폼에 접속하셨습니다.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="labit-card p-5">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-xs font-semibold text-labit-subtext uppercase">전체 실험 수</p>
              <p class="text-3xl font-extrabold text-labit-text mt-1">${summary.totalExperiments}</p>
            </div>
            <div class="p-2.5 bg-emerald-50 rounded-xl text-labit-primary shadow-inner">
              <i data-lucide="flask-conical" class="w-5 h-5"></i>
            </div>
          </div>
          <div class="mt-3 flex items-center space-x-2 text-xs">
            <span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold">진행 중 ${summary.inProgressExperiments}</span>
            <span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-bold">완료 ${summary.completedExperiments}</span>
          </div>
        </div>

        <div class="labit-card p-5">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-xs font-semibold text-labit-subtext uppercase">연구 자료</p>
              <p class="text-3xl font-extrabold text-labit-text mt-1">${summary.materialsCount}</p>
            </div>
            <div class="p-2.5 bg-emerald-50 rounded-xl text-labit-primary shadow-inner">
              <i data-lucide="book-open" class="w-5 h-5"></i>
            </div>
          </div>
          <span class="text-xs text-labit-subtext mt-3 inline-block">Materials DB 연동</span>
        </div>

        <div class="labit-card p-5">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-xs font-semibold text-labit-subtext uppercase">예정 일정</p>
              <p class="text-3xl font-extrabold text-labit-text mt-1">${summary.schedulesCount}</p>
            </div>
            <div class="p-2.5 bg-emerald-50 rounded-xl text-labit-primary shadow-inner">
              <i data-lucide="calendar" class="w-5 h-5"></i>
            </div>
          </div>
          <span class="text-xs text-labit-subtext mt-3 inline-block">Schedules DB 연동</span>
        </div>

        <div class="labit-card p-5">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-xs font-semibold text-labit-subtext uppercase">최근 활동</p>
              <p class="text-3xl font-extrabold text-labit-text mt-1">${summary.activitiesCount}</p>
            </div>
            <div class="p-2.5 bg-emerald-50 rounded-xl text-labit-primary shadow-inner">
              <i data-lucide="activity" class="w-5 h-5"></i>
            </div>
          </div>
          <span class="text-xs text-labit-subtext mt-3 inline-block">Activities DB 연동</span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="labit-card p-6">
          <div class="flex justify-between items-center mb-4">
            <h4 class="font-bold text-labit-text flex items-center space-x-2">
              <i data-lucide="bell" class="w-4 h-4 text-labit-primary"></i>
              <span>동아리 공지사항</span>
            </h4>
            <button onclick="navigateTo('community')" class="text-xs text-labit-primary hover:underline font-semibold">전체보기</button>
          </div>
          <div class="space-y-3">
            ${summary.recentPosts && summary.recentPosts.length > 0 ? summary.recentPosts.map(p => `
              <div class="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center">
                <span class="text-sm font-semibold text-labit-text truncate max-w-xs">${p.title}</span>
                <span class="text-xs text-labit-subtext">${String(p.createdAt || '').substring(0, 10)}</span>
              </div>
            `).join('') : '<p class="text-xs text-labit-subtext py-6 text-center">등록된 공지사항이 없습니다.</p>'}
          </div>
        </div>

        <div class="labit-card p-6">
          <div class="flex justify-between items-center mb-4">
            <h4 class="font-bold text-labit-text flex items-center space-x-2">
              <i data-lucide="book-open" class="w-4 h-4 text-labit-primary"></i>
              <span>최근 연구 자료</span>
            </h4>
            <button onclick="navigateTo('materials')" class="text-xs text-labit-primary hover:underline font-semibold">전체보기</button>
          </div>
          <div class="space-y-3">
            ${summary.recentMaterials && summary.recentMaterials.length > 0 ? summary.recentMaterials.map(m => `
              <div class="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center">
                <span class="text-sm font-semibold text-labit-text truncate max-w-xs">${m.title}</span>
                <span class="px-2 py-0.5 bg-emerald-50 text-labit-primary text-[10px] font-bold rounded">${m.category || '기타'}</span>
              </div>
            `).join('') : '<p class="text-xs text-labit-subtext py-6 text-center">등록된 연구 자료가 없습니다.</p>'}
          </div>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}


// ==========================================
// 4. 실험 관리 모듈 전체 구현
// ==========================================
async function renderExperimentsView(container) {
  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-labit-border shadow-xs">
        <div>
          <h3 class="text-lg font-bold text-labit-text">실험 프로젝트 관리</h3>
          <p class="text-xs text-labit-subtext mt-0.5">의생명 과학 실험 계획, 일지, 측정 데이터 및 시각화 리포트를 관리합니다.</p>
        </div>
        <button onclick="openExperimentModal('create')" class="px-4 py-2.5 bg-gradient-to-r from-labit-primary to-emerald-600 hover:from-emerald-600 hover:to-teal-700 text-white text-xs font-bold rounded-xl transition-all shadow-md hover:shadow-lg active:scale-95 flex items-center space-x-2 cursor-pointer">
          <i data-lucide="plus" class="w-4 h-4"></i>
          <span>새 실험 등록</span>
        </button>
      </div>

      <div class="flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
          <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3.5 top-3"></i>
          <input type="text" id="exp-search-input" onkeyup="filterExperiments()" placeholder="실험 제목, 분야, 담당자 검색..." class="w-full pl-10 pr-4 py-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-labit-primary shadow-xs">
        </div>
        <select id="exp-status-filter" onchange="filterExperiments()" class="px-3.5 py-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-labit-primary shadow-xs font-semibold text-labit-text">
          <option value="ALL">전체 상태</option>
          <option value="PLANNING">계획</option>
          <option value="IN_PROGRESS">진행 중</option>
          <option value="COMPLETED">완료</option>
          <option value="HOLD">보류</option>
        </select>
      </div>

      <div id="experiments-list-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div class="col-span-full text-center py-12 text-labit-subtext font-semibold flex items-center justify-center space-x-2">
          <i data-lucide="loader-2" class="w-5 h-5 animate-spin text-labit-primary"></i>
          <span>실험 데이터를 불러오는 중입니다...</span>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
  await loadExperimentsList();
}

async function loadExperimentsList() {
  const container = document.getElementById('experiments-list-container');
  if (!container) return;

  try {
    const res = await API.post('experiments/list');
    if (res.success && res.data) {
      experimentsDataCache = res.data;
      renderExperimentsList(experimentsDataCache);
    } else {
      container.innerHTML = `<p class="col-span-full text-center py-12 text-xs text-red-500 font-semibold">${res.message || '실험 목록을 로드할 수 없습니다.'}</p>`;
    }
  } catch (e) {
    container.innerHTML = `<p class="col-span-full text-center py-12 text-xs text-red-500 font-semibold">서버 통신 오류: ${e.message}</p>`;
  }
}

function filterExperiments() {
  const searchInput = document.getElementById('exp-search-input');
  const statusFilter = document.getElementById('exp-status-filter');

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const status = statusFilter ? statusFilter.value : 'ALL';

  const filtered = experimentsDataCache.filter(item => {
    const matchesQuery = !query || 
      (item.title && item.title.toLowerCase().includes(query)) ||
      (item.category && item.category.toLowerCase().includes(query)) ||
      (item.leadAuthorId && item.leadAuthorId.toLowerCase().includes(query));

    const matchesStatus = (status === 'ALL') || (item.status === status);
    return matchesQuery && matchesStatus;
  });

  renderExperimentsList(filtered);
}

function renderExperimentsList(list) {
  const container = document.getElementById('experiments-list-container');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div class="col-span-full labit-card p-12 text-center space-y-3">
        <i data-lucide="flask-conical" class="w-10 h-10 text-slate-300 mx-auto"></i>
        <p class="text-sm font-bold text-labit-text">등록된 실험 프로젝트가 없습니다.</p>
        <p class="text-xs text-labit-subtext">상단의 [새 실험 등록] 버튼을 눌러 연구 프로젝트를 시작하세요.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = list.map(exp => {
    const statusMap = {
      PLANNING: { label: '계획', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
      IN_PROGRESS: { label: '진행 중', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 animate-pulse' },
      COMPLETED: { label: '완료', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
      HOLD: { label: '보류', bg: 'bg-slate-100 text-slate-600 border-slate-200' }
    };
    const st = statusMap[exp.status] || statusMap.PLANNING;

    return `
      <div class="labit-card p-5 flex flex-col justify-between space-y-4 relative group">
        <div>
          <div class="flex justify-between items-start gap-2">
            <span class="px-2.5 py-1 text-[11px] font-bold rounded-lg border ${st.bg}">${st.label}</span>
            <span class="text-[11px] font-bold text-labit-subtext bg-slate-100 px-2 py-0.5 rounded">${exp.category || '일반'}</span>
          </div>

          <h4 class="font-bold text-base text-labit-text mt-3 group-hover:text-labit-primary transition-colors cursor-pointer" onclick="viewExperimentDetail('${exp.id}')">
            ${exp.title}
          </h4>
          <p class="text-xs text-labit-subtext mt-1.5 line-clamp-2 leading-relaxed">${exp.description || '목적 정보가 없습니다.'}</p>
        </div>

        <div class="space-y-3 pt-3 border-t border-slate-100">
          <div class="flex items-center justify-between text-xs text-labit-subtext font-medium">
            <div class="flex items-center space-x-1">
              <i data-lucide="user" class="w-3.5 h-3.5"></i>
              <span>${exp.leadAuthorId || '담당자 미정'}</span>
            </div>
            <div class="flex items-center space-x-1">
              <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
              <span>${exp.startDate || '시작일 미정'}</span>
            </div>
          </div>

          <div class="flex items-center justify-end space-x-1.5">
            <button onclick="duplicateExperiment('${exp.id}')" title="실험 복제" class="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
              <i data-lucide="copy" class="w-4 h-4"></i>
            </button>
            <button onclick="openExperimentModal('edit', '${exp.id}')" title="실험 수정" class="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="archiveExperiment('${exp.id}')" title="보관" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <i data-lucide="archive" class="w-4 h-4"></i>
            </button>
            <button onclick="viewExperimentDetail('${exp.id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-labit-text text-xs font-bold rounded-lg transition-colors">
              상세보기
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function viewExperimentDetail(expId) {
  const modal = document.getElementById('experiment-modal');
  if (!modal) return;

  modal.innerHTML = `
    <div class="bg-white border border-slate-100 rounded-3xl shadow-2xl max-w-3xl w-full p-6 relative max-h-[90vh] flex flex-col items-center justify-center">
      <i data-lucide="loader-2" class="w-8 h-8 animate-spin text-labit-primary"></i>
      <span class="text-xs font-bold text-labit-subtext mt-3">실험 상세 및 기록 데이터를 조회 중입니다...</span>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();

  try {
    const res = await API.post('experiments/get', { id: expId });
    if (res.success && res.data) {
      experimentDetailCache = res.data;
      renderExperimentDetailModal(experimentDetailCache);
    } else {
      alert('실험 정보 조회 실패: ' + res.message);
      closeExperimentModal();
    }
  } catch (e) {
    alert('서버 오류: ' + e.message);
    closeExperimentModal();
  }
}

function renderExperimentDetailModal(detailData) {
  const modal = document.getElementById('experiment-modal');
  if (!modal) return;

  const exp = detailData.experiment;
  const logs = detailData.logs || [];
  const measurementData = detailData.data || [];

  modal.innerHTML = `
    <div class="bg-white border border-slate-100 rounded-3xl shadow-2xl max-w-4xl w-full p-6 relative max-h-[90vh] flex flex-col overflow-hidden">
      <div class="flex justify-between items-start pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center space-x-2">
            <span class="px-2.5 py-0.5 text-xs font-bold rounded bg-emerald-50 text-labit-primary border border-emerald-200">${exp.category || '일반'}</span>
            <span class="text-xs text-labit-subtext font-semibold">${exp.generation || 2026}기 (${exp.year || 2026}년)</span>
          </div>
          <h3 class="text-xl font-bold text-labit-text mt-1">${exp.title}</h3>
        </div>
        <div class="flex items-center space-x-2">
          <button onclick="exportExperimentCSV()" class="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-all flex items-center space-x-1 cursor-pointer">
            <i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>
            <span>CSV 내보내기</span>
          </button>
          <button onclick="closeExperimentModal()" class="p-2 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
      </div>

      <div class="flex space-x-4 border-b border-slate-200 pt-3">
        <button id="exp-tab-btn-info" onclick="switchExpTab('info')" class="pb-2 text-xs font-bold text-labit-primary border-b-2 border-labit-primary">실험 정보</button>
        <button id="exp-tab-btn-logs" onclick="switchExpTab('logs')" class="pb-2 text-xs font-bold text-slate-400 hover:text-labit-text">실험 일지 (${logs.length})</button>
        <button id="exp-tab-btn-chart" onclick="switchExpTab('chart')" class="pb-2 text-xs font-bold text-slate-400 hover:text-labit-text">측정 데이터 & 그래프</button>
      </div>

      <div class="flex-1 overflow-y-auto py-4 space-y-6">
        <div id="exp-tab-content-info" class="space-y-4">
          <div class="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
            <div><span class="font-bold text-slate-500">담당자:</span> <span class="font-semibold text-slate-800">${exp.leadAuthorId}</span></div>
            <div><span class="font-bold text-slate-500">참여자:</span> <span class="font-semibold text-slate-800">${exp.participants || '미정'}</span></div>
            <div><span class="font-bold text-slate-500">시작일:</span> <span class="font-semibold text-slate-800">${exp.startDate || '-'}</span></div>
            <div><span class="font-bold text-slate-500">종료일:</span> <span class="font-semibold text-slate-800">${exp.endDate || '-'}</span></div>
          </div>

          <div class="space-y-3 text-xs">
            <div>
              <h5 class="font-bold text-labit-text mb-1 text-sm">실험 목적</h5>
              <div class="p-3 bg-white border border-slate-200 rounded-xl leading-relaxed">${exp.description || '입력된 목적이 없습니다.'}</div>
            </div>
            <div>
              <h5 class="font-bold text-labit-text mb-1 text-sm">가설 (Hypothesis)</h5>
              <div class="p-3 bg-white border border-slate-200 rounded-xl leading-relaxed">${exp.hypothesis || '입력된 가설이 없습니다.'}</div>
            </div>
            <div>
              <h5 class="font-bold text-labit-text mb-1 text-sm">준비물 및 시약</h5>
              <div class="p-3 bg-white border border-slate-200 rounded-xl leading-relaxed">${exp.materials || '준비물 정보가 없습니다.'}</div>
            </div>
            <div>
              <h5 class="font-bold text-labit-text mb-1 text-sm">실험 방법 (Method)</h5>
              <div class="p-3 bg-white border border-slate-200 rounded-xl leading-relaxed">${exp.method || '입력된 방법이 없습니다.'}</div>
            </div>
            <div>
              <h5 class="font-bold text-labit-text mb-1 text-sm">결과 및 결론</h5>
              <div class="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl leading-relaxed">${exp.result || '입력된 결과가 없습니다.'}</div>
            </div>
          </div>
        </div>

        <div id="exp-tab-content-logs" class="hidden space-y-4">
          <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2">
            <textarea id="new-exp-log-input" rows="2" placeholder="새로운 실험 일지 및 관찰 기록을 남기세요..." class="w-full p-3 text-xs border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary"></textarea>
            <div class="flex justify-end">
              <button onclick="addExperimentLog('${exp.id}')" class="px-4 py-2 bg-labit-primary hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center space-x-1 cursor-pointer">
                <i data-lucide="send" class="w-3.5 h-3.5"></i>
                <span>일지 기록</span>
              </button>
            </div>
          </div>

          <div class="space-y-3 pt-2">
            ${logs.length > 0 ? logs.map(log => `
              <div class="p-4 bg-white border border-slate-200 rounded-xl space-y-1">
                <div class="flex justify-between items-center text-[11px] text-labit-subtext font-semibold">
                  <span>작성자: ${log.authorId || '동아리원'}</span>
                  <span>${String(log.createdAt || log.logDate || '').substring(0, 19).replace('T', ' ')}</span>
                </div>
                <p class="text-xs text-labit-text leading-relaxed mt-1">${log.content}</p>
              </div>
            `).join('') : '<p class="text-xs text-labit-subtext text-center py-8">등록된 실험 일지가 없습니다.</p>'}
          </div>
        </div>

        <div id="exp-tab-content-chart" class="hidden space-y-4">
          <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
            <h5 class="text-xs font-bold text-labit-text">수치 측정 데이터 추가</h5>
            <div class="grid grid-cols-2 gap-3">
              <input type="text" id="meas-label-input" placeholder="X축 라벨 (예: 10분 후, Sample A)" class="px-3 py-2 text-xs border border-slate-300 rounded-lg">
              <input type="number" id="meas-value-input" placeholder="측정 값 (예: 15.5)" class="px-3 py-2 text-xs border border-slate-300 rounded-lg">
            </div>
            <button onclick="addMeasurementData('${exp.id}')" class="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition-colors">
              데이터 포인트 추가
            </button>
          </div>

          <div class="bg-white p-4 border border-slate-200 rounded-2xl">
            <h5 class="text-xs font-bold text-labit-text mb-3">실험 결과 시각화 그래프</h5>
            <div class="h-64 w-full">
              <canvas id="experimentChartCanvas"></canvas>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function switchExpTab(tabName) {
  const tabs = ['info', 'logs', 'chart'];
  tabs.forEach(t => {
    const btn = document.getElementById(`exp-tab-btn-${t}`);
    const content = document.getElementById(`exp-tab-content-${t}`);
    if (btn && content) {
      if (t === tabName) {
        btn.className = 'pb-2 text-xs font-bold text-labit-primary border-b-2 border-labit-primary';
        content.classList.remove('hidden');
      } else {
        btn.className = 'pb-2 text-xs font-bold text-slate-400 hover:text-labit-text';
        content.classList.add('hidden');
      }
    }
  });

  if (tabName === 'chart') {
    renderExperimentChart();
  }
}

let currentChartInstance = null;
function renderExperimentChart() {
  const canvas = document.getElementById('experimentChartCanvas');
  if (!canvas || !experimentDetailCache) return;

  const dataList = experimentDetailCache.data || [];
  const labels = dataList.map((d, i) => d.fileName || `Point ${i + 1}`);
  const values = dataList.map(d => Number(d.fileSize || d.contentValue || 0));

  if (currentChartInstance) {
    currentChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  currentChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length > 0 ? labels : ['기초 측정', '1차', '2차', '최종'],
      datasets: [{
        label: '실험 측정 수치',
        data: values.length > 0 ? values : [0, 0, 0, 0],
        borderColor: '#279B78',
        backgroundColor: 'rgba(39, 155, 120, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { font: { family: 'Pretendard', size: 11 } } }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

async function addExperimentLog(expId) {
  const input = document.getElementById('new-exp-log-input');
  if (!input || !input.value.trim()) {
    alert('일지 내용을 입력해 주세요.');
    return;
  }

  const content = input.value.trim();
  try {
    const res = await API.post('experiments/addLog', { experimentId: expId, content: content });
    if (res.success) {
      viewExperimentDetail(expId);
    } else {
      alert('일지 저장 실패: ' + res.message);
    }
  } catch (e) {
    alert('오류: ' + e.message);
  }
}

async function addMeasurementData(expId) {
  const labelInput = document.getElementById('meas-label-input');
  const valInput = document.getElementById('meas-value-input');

  if (!labelInput || !valInput || !valInput.value.trim()) {
    alert('측정 라벨과 수치 값을 정확히 입력해 주세요.');
    return;
  }

  try {
    const res = await API.post('experiments/addData', {
      experimentId: expId,
      label: labelInput.value.trim(),
      value: Number(valInput.value)
    });

    if (res.success) {
      viewExperimentDetail(expId);
    } else {
      alert('데이터 추가 실패: ' + res.message);
    }
  } catch (e) {
    alert('오류: ' + e.message);
  }
}

function exportExperimentCSV() {
  if (!experimentDetailCache) return;
  const exp = experimentDetailCache.experiment;
  const logs = experimentDetailCache.logs || [];
  const data = experimentDetailCache.data || [];

  let csv = `\uFEFFLABIT 실험 보고서 내보내기\n`;
  csv += `제목,${exp.title}\n`;
  csv += `분야,${exp.category || ''}\n`;
  csv += `담당자,${exp.leadAuthorId}\n`;
  csv += `상태,${exp.status}\n`;
  csv += `목적,${(exp.description || '').replace(/\n/g, ' ')}\n`;
  csv += `가설,${(exp.hypothesis || '').replace(/\n/g, ' ')}\n\n`;

  csv += `[실험 일지 기록]\n시각,작성자,내용\n`;
  logs.forEach(l => {
    csv += `"${l.createdAt}","${l.authorId}","${(l.content || '').replace(/\n/g, ' ')}"\n`;
  });

  csv += `\n[측정 데이터 수치]\n라벨,수치\n`;
  data.forEach(d => {
    csv += `"${d.fileName}","${d.fileSize}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `LABIT_Experiment_${exp.id.substring(0, 8)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openExperimentModal(mode, expId = null) {
  const modal = document.getElementById('experiment-modal');
  if (!modal) return;

  let exp = {
    title: '', category: '미생물학', status: 'PLANNING', leadAuthorId: Auth.getUser() ? Auth.getUser().name : '',
    startDate: new Date().toISOString().substring(0, 10), endDate: '', description: '', hypothesis: '',
    materials: '', method: '', result: ''
  };

  if (mode === 'edit' && expId) {
    const found = experimentsDataCache.find(e => e.id === expId);
    if (found) exp = found;
  }

  modal.innerHTML = `
    <div class="bg-white border border-slate-100 rounded-3xl shadow-2xl max-w-2xl w-full p-6 relative max-h-[90vh] flex flex-col">
      <div class="flex justify-between items-center pb-3 border-b border-slate-100">
        <h3 class="text-lg font-bold text-labit-text">${mode === 'create' ? '새 실험 프로젝트 등록' : '실험 정보 수정'}</h3>
        <button onclick="closeExperimentModal()" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
      </div>

      <form id="exp-form" onsubmit="saveExperiment(event, '${mode}', '${expId || ''}')" class="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
        <div>
          <label class="block font-bold text-labit-text mb-1">실험 제목 *</label>
          <input type="text" id="form-exp-title" value="${exp.title}" required placeholder="예: 대장균 형질전환 및 유전자 발현 실험" class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-labit-text mb-1">분야</label>
            <select id="form-exp-category" class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">
              <option value="분자생물학" ${exp.category === '분자생물학' ? 'selected' : ''}>분자생물학</option>
              <option value="미생물학" ${exp.category === '미생물학' ? 'selected' : ''}>미생물학</option>
              <option value="유전공학" ${exp.category === '유전공학' ? 'selected' : ''}>유전공학</option>
              <option value="생화학" ${exp.category === '생화학' ? 'selected' : ''}>생화학</option>
              <option value="일반" ${exp.category === '일반' ? 'selected' : ''}>일반 의생명</option>
            </select>
          </div>
          <div>
            <label class="block font-bold text-labit-text mb-1">상태</label>
            <select id="form-exp-status" class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">
              <option value="PLANNING" ${exp.status === 'PLANNING' ? 'selected' : ''}>계획</option>
              <option value="IN_PROGRESS" ${exp.status === 'IN_PROGRESS' ? 'selected' : ''}>진행 중</option>
              <option value="COMPLETED" ${exp.status === 'COMPLETED' ? 'selected' : ''}>완료</option>
              <option value="HOLD" ${exp.status === 'HOLD' ? 'selected' : ''}>보류</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-labit-text mb-1">담당자</label>
            <input type="text" id="form-exp-author" value="${exp.leadAuthorId}" placeholder="담당 학생 이름" class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">
          </div>
          <div>
            <label class="block font-bold text-labit-text mb-1">시작일</label>
            <input type="date" id="form-exp-startdate" value="${exp.startDate}" class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">
          </div>
        </div>

        <div>
          <label class="block font-bold text-labit-text mb-1">실험 목적</label>
          <textarea id="form-exp-desc" rows="2" placeholder="실험의 주 목적 및 탐구 동기..." class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">${exp.description}</textarea>
        </div>

        <div>
          <label class="block font-bold text-labit-text mb-1">가설 (Hypothesis)</label>
          <textarea id="form-exp-hypo" rows="2" placeholder="실험 가설..." class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">${exp.hypothesis}</textarea>
        </div>

        <div>
          <label class="block font-bold text-labit-text mb-1">준비물 및 시약</label>
          <input type="text" id="form-exp-materials" value="${exp.materials || ''}" placeholder="예: LB 배지, Ampicillin, CaCl2 시약" class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">
        </div>

        <div>
          <label class="block font-bold text-labit-text mb-1">실험 프로토콜 (방법)</label>
          <textarea id="form-exp-method" rows="3" placeholder="1. 멸균 작업... 2. 배양기 작동..." class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">${exp.method || ''}</textarea>
        </div>

        <div class="pt-2">
          <button type="submit" class="w-full py-3 bg-gradient-to-r from-labit-primary to-emerald-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl transition-all shadow-md cursor-pointer">
            ${mode === 'create' ? '새 실험 프로젝트 생성' : '실험 정보 변경 사항 저장'}
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
}

function closeExperimentModal() {
  const modal = document.getElementById('experiment-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

async function saveExperiment(e, mode, expId) {
  e.preventDefault();

  const expData = {
    id: mode === 'edit' ? expId : undefined,
    title: document.getElementById('form-exp-title').value.trim(),
    category: document.getElementById('form-exp-category').value,
    status: document.getElementById('form-exp-status').value,
    leadAuthorId: document.getElementById('form-exp-author').value.trim(),
    startDate: document.getElementById('form-exp-startdate').value,
    description: document.getElementById('form-exp-desc').value.trim(),
    hypothesis: document.getElementById('form-exp-hypo').value.trim(),
    materials: document.getElementById('form-exp-materials').value.trim(),
    method: document.getElementById('form-exp-method').value.trim()
  };

  try {
    const action = mode === 'create' ? 'experiments/create' : 'experiments/update';
    const res = await API.post(action, expData);

    if (res.success) {
      closeExperimentModal();
      await loadExperimentsList();
    } else {
      alert('저장 실패: ' + res.message);
    }
  } catch (err) {
    alert('오류: ' + err.message);
  }
}

async function duplicateExperiment(expId) {
  if (!confirm('이 실험의 가설 및 방법을 복사하여 새 실험으로 생성하시겠습니까?')) return;

  try {
    const res = await API.post('experiments/duplicate', { id: expId });
    if (res.success) {
      await loadExperimentsList();
    } else {
      alert('복제 실패: ' + res.message);
    }
  } catch (e) {
    alert('오류: ' + e.message);
  }
}

async function archiveExperiment(expId) {
  if (!confirm('해당 실험 프로젝트를 보관 처리하시겠습니까?')) return;

  try {
    const res = await API.post('experiments/archive', { id: expId });
    if (res.success) {
      await loadExperimentsList();
    } else {
      alert('보관 처리 실패: ' + res.message);
    }
  } catch (e) {
    alert('오류: ' + e.message);
  }
}


// ==========================================
// 5. 관리자 테스트 및 뷰 헬퍼
// ==========================================
function getAdminTestViewHTML() {
  const cfg = safeConfig();
  return `
    <div class="space-y-6">
      <div class="labit-card p-6 space-y-4">
        <div>
          <h3 class="text-lg font-bold text-labit-text flex items-center space-x-2">
            <i data-lucide="database" class="w-5 h-5 text-labit-primary"></i>
            <span>6단계 DB 연결 관리자 통신 설정</span>
          </h3>
          <p class="text-xs text-labit-subtext mt-1">Google OAuth Client ID 및 GAS Web App API 주소를 설정합니다.</p>
        </div>

        <div class="grid grid-cols-1 gap-4 p-4 bg-slate-50 border border-labit-border rounded-xl">
          <div class="space-y-1">
            <label class="block text-xs font-semibold text-labit-text">GAS Web App URL</label>
            <input type="text" id="gas-url-input" value="${cfg.GAS_API_URL || ''}" placeholder="https://script.google.com/macros/s/.../exec" class="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-labit-primary">
          </div>

          <div class="space-y-1">
            <label class="block text-xs font-semibold text-labit-text">Google OAuth Client ID</label>
            <input type="text" id="google-client-id-input" value="${cfg.GOOGLE_CLIENT_ID || ''}" placeholder="xxxxxx.apps.googleusercontent.com" class="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-labit-primary">
          </div>

          <button onclick="saveAdminSettings()" class="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer">
            설정 값 저장
          </button>
        </div>
      </div>
    </div>
  `;
}

function saveAdminSettings() {
  const urlInput = document.getElementById('gas-url-input');
  const clientIdInput = document.getElementById('google-client-id-input');

  const cfg = safeConfig();
  if (urlInput) cfg.GAS_API_URL = urlInput.value.trim();
  if (clientIdInput) cfg.GOOGLE_CLIENT_ID = clientIdInput.value.trim();
  cfg.GAS_API_URL = String(cfg.GAS_API_URL || '').trim();
  try {
    localStorage.setItem('labit_public_config', JSON.stringify({
      GAS_API_URL: cfg.GAS_API_URL,
      GOOGLE_CLIENT_ID: cfg.GOOGLE_CLIENT_ID
    }));
  } catch (e) {
    alert('브라우저에 설정을 저장하지 못했습니다: ' + e.message);
    return;
  }

  Auth.initGoogleGIS();
  renderSidebarNav();
  alert('설정이 정상 저장되었습니다.');
}

function getPlaceholderViewHTML(menuItem) {
  return `
    <div class="labit-card p-12 text-center max-w-2xl mx-auto my-8 space-y-4">
      <div class="w-16 h-16 bg-labit-primary/10 text-labit-primary rounded-2xl flex items-center justify-center mx-auto shadow-inner">
        <i data-lucide="${menuItem.icon}" class="w-8 h-8"></i>
      </div>
      <div>
        <h3 class="text-xl font-bold text-labit-text">${menuItem.name}</h3>
        <p class="text-sm text-labit-subtext mt-1">해당 기능은 아직 준비 중입니다. 데이터 입력 및 저장 기능은 활성화되지 않았습니다.</p>
      </div>
    </div>
  `;
}