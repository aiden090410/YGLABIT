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

        // 로그인한 사용자 권한에 맞춰 메뉴 다시 생성
        if (window.renderSidebarNav) window.renderSidebarNav();
        if (window.renderMobileNav) window.renderMobileNav();

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

  const viewMap = {
    dashboard: typeof renderDashboardView === 'function' ? renderDashboardView : null,
    experiments: typeof renderExperimentsView === 'function' ? renderExperimentsView : null,
    materials: typeof renderMaterialsView === 'function' ? renderMaterialsView : null,
    schedules: typeof renderSchedulesView === 'function' ? renderSchedulesView : null,
    members: typeof renderMembersView === 'function' ? renderMembersView : null,
    archive: typeof renderArchiveView === 'function' ? renderArchiveView : null,
    community: typeof renderCommunityView === 'function' ? renderCommunityView : null
  };

  const renderFunction = viewMap[menuItem.id];

  if (typeof renderFunction === 'function') {
    renderFunction(contentEl);
  } else if (menuItem.id === 'admin') {
    contentEl.innerHTML = getAdminTestViewHTML();
  } else {
    contentEl.innerHTML = getPlaceholderViewHTML(menuItem);
  }

  if (window.lucide) lucide.createIcons();
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
  const labels = dataList.map((d, i) =>
  d.label || d.fileName || `Point ${i + 1}`);
  const values = dataList.map(d => Number(d.numericValue ?? 0));
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
    <input type="text" id="form-exp-author"
      value="${exp.leadAuthorId || ''}"
      placeholder="담당 학생 이름"
      class="w-full px-3.5 py-2 border border-slate-300 rounded-xl">
  </div>
  <div>
    <label class="block font-bold text-labit-text mb-1">시작일</label>
    <input type="date" id="form-exp-startdate"
      value="${exp.startDate || ''}"
      class="w-full px-3.5 py-2 border border-slate-300 rounded-xl">
  </div>
</div>

        <div>
          <label class="block font-bold text-labit-text mb-1">종료일</label>
          <input type="date" id="form-exp-enddate"
            value="${exp.endDate || ''}"
            class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">
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

        <div>
          <label class="block font-bold text-labit-text mb-1">실험 결과 및 결론</label>
          <textarea id="form-exp-result" rows="3"
            placeholder="실험 결과와 분석 및 결론을 기록하세요."
            class="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:outline-none focus:border-labit-primary">${exp.result || ''}</textarea>
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

  const getValue = id => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };

  const expData = {
    id: mode === 'edit' ? expId : undefined,
    title: getValue('form-exp-title'),
    category: getValue('form-exp-category'),
    status: getValue('form-exp-status'),
    leadAuthorId: getValue('form-exp-author'),
    startDate: getValue('form-exp-startdate'),
    endDate: getValue('form-exp-enddate'),
    description: getValue('form-exp-desc'),
    hypothesis: getValue('form-exp-hypo'),
    materials: getValue('form-exp-materials'),
    method: getValue('form-exp-method'),
    result: getValue('form-exp-result')
  };

  if (!expData.title) {
    alert('실험 제목을 입력해 주세요.');
    return;
  }

  try {
    const action = mode === 'create'
      ? 'experiments/create'
      : 'experiments/update';

    const res = await API.post(action, expData);

    if (res.success) {
      alert(mode === 'create' ? '실험이 등록되었습니다.' : '실험 정보가 수정되었습니다.');
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


// ==========================================
// 연구 자료실
// ==========================================
let materialsDataCache = [];

function materialEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function materialTypeLabel(type) {
  return ({ PAPER: '논문', ARTICLE: '기사', BOOK: '도서', REPORT: '보고서', ETC: '기타' })[type] || type || '기타';
}

async function renderMaterialsView(container) {
  container.innerHTML = `
    <div class="space-y-5">
      <div class="labit-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 class="text-lg font-bold text-labit-text">연구 자료실</h3>
          <p class="text-xs text-labit-subtext mt-1">논문, 기사, 도서 등 동아리 연구에 참고한 자료를 모아 관리합니다.</p>
        </div>
        <button onclick="openMaterialModal()" class="px-4 py-2.5 bg-labit-primary hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-2">
          <i data-lucide="plus" class="w-4 h-4"></i><span>자료 등록</span>
        </button>
      </div>

      <div class="flex flex-col md:flex-row gap-3">
        <div class="relative flex-1">
          <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3.5 top-3"></i>
          <input id="material-search" oninput="filterMaterials()" placeholder="제목, 저자, 출처, 키워드 검색" class="w-full pl-10 pr-4 py-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-labit-primary">
        </div>
        <select id="material-type-filter" onchange="filterMaterials()" class="px-3 py-2.5 text-xs bg-white border border-slate-200 rounded-xl">
          <option value="ALL">모든 자료 유형</option><option value="PAPER">논문</option><option value="ARTICLE">기사</option><option value="BOOK">도서</option><option value="REPORT">보고서</option><option value="ETC">기타</option>
        </select>
        <select id="material-category-filter" onchange="filterMaterials()" class="px-3 py-2.5 text-xs bg-white border border-slate-200 rounded-xl">
          <option value="ALL">모든 분야</option><option>생명과학</option><option>의학</option><option>생명윤리</option><option>화학</option><option>인공지능</option><option>기타</option>
        </select>
        <label class="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-600">
          <input id="material-favorites-only" type="checkbox" onchange="filterMaterials()" class="accent-emerald-600"> 즐겨찾기만
        </label>
      </div>
      <div id="materials-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div class="col-span-full text-center py-12 text-sm text-slate-400">자료를 불러오는 중입니다...</div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  await loadMaterials();
}

async function loadMaterials() {
  const target = document.getElementById('materials-list');
  if (!target) return;
  const res = await API.post('materials/list');
  if (!res.success) {
    target.innerHTML = `<div class="col-span-full labit-card p-8 text-center text-sm text-red-500">${materialEscape(res.message || '자료를 불러오지 못했습니다.')}</div>`;
    return;
  }
  materialsDataCache = Array.isArray(res.data) ? res.data : [];
  filterMaterials();
}

function filterMaterials() {
  const target = document.getElementById('materials-list');
  if (!target) return;
  const q = (document.getElementById('material-search')?.value || '').trim().toLowerCase();
  const type = document.getElementById('material-type-filter')?.value || 'ALL';
  const category = document.getElementById('material-category-filter')?.value || 'ALL';
  const favoritesOnly = !!document.getElementById('material-favorites-only')?.checked;
  const filtered = materialsDataCache.filter(m => {
    const haystack = [m.title, m.authors, m.source, m.summary, m.category, m.doi].join(' ').toLowerCase();
    return (!q || haystack.includes(q)) &&
      (type === 'ALL' || m.type === type) &&
      (category === 'ALL' || m.category === category) &&
      (!favoritesOnly || m.isFavorite);
  });
  if (!filtered.length) {
    target.innerHTML = `<div class="col-span-full labit-card p-10 text-center"><i data-lucide="book-open" class="w-8 h-8 text-slate-300 mx-auto mb-3"></i><p class="text-sm font-bold text-labit-text">조건에 맞는 자료가 없습니다.</p><p class="text-xs text-labit-subtext mt-1">검색 조건을 바꾸거나 새 자료를 등록해 보세요.</p></div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }
  const user = Auth.getUser();
  target.innerHTML = filtered.map(m => {
    const canEdit = user && (user.role === 'ADMIN' || String(user.id) === String(m.authorId));
    const title = materialEscape(m.title);
    return `
      <article class="labit-card p-5 flex flex-col min-h-[230px]">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="px-2 py-1 rounded-lg bg-emerald-50 text-labit-primary text-[10px] font-bold">${materialEscape(materialTypeLabel(m.type))}</span>
            <span class="text-[10px] text-slate-500 truncate">${materialEscape(m.category || '기타')}</span>
          </div>
          <button onclick="toggleMaterialFavorite('${materialEscape(m.id)}')" aria-label="즐겨찾기" class="p-1.5 rounded-lg hover:bg-amber-50 ${m.isFavorite ? 'text-amber-500' : 'text-slate-300'}"><i data-lucide="star" class="w-4 h-4" ${m.isFavorite ? 'fill="currentColor"' : ''}></i></button>
        </div>
        <button onclick="openMaterialDetail('${materialEscape(m.id)}')" class="text-left mt-4">
          <h4 class="font-bold text-labit-text leading-snug line-clamp-2">${title}</h4>
          <p class="text-xs text-slate-500 mt-2">${materialEscape(m.authors || '저자 정보 없음')}${m.source ? ' · ' + materialEscape(m.source) : ''}</p>
          <p class="text-xs text-labit-subtext mt-3 leading-relaxed line-clamp-3">${materialEscape(m.summary || m.content || m.selectionReason || '요약 내용이 등록되지 않았습니다.')}</p>
        </button>
        <div class="mt-auto pt-4 flex items-center justify-between gap-2">
          <span class="text-[10px] text-slate-400">${materialEscape(m.authorName || '동아리원')}</span>
          <div class="flex items-center gap-2">
            ${m.url ? `<a href="${materialEscape(m.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="text-[10px] font-bold text-labit-primary hover:underline">원문 보기</a>` : ''}
            <button onclick="openMaterialDetail('${materialEscape(m.id)}')" class="text-[10px] font-bold text-slate-500 hover:text-labit-primary">상세 보기</button>
            ${canEdit ? `<button onclick="openMaterialModal('${materialEscape(m.id)}')" class="text-[10px] font-bold text-slate-500 hover:text-labit-primary">수정</button>` : ''}
          </div>
        </div>
      </article>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

async function toggleMaterialFavorite(id) {
  const res = await API.post('materials/toggleFavorite', { id });
  if (!res.success) { alert(res.message || '즐겨찾기를 변경하지 못했습니다.'); return; }
  const item = materialsDataCache.find(m => String(m.id) === String(id));
  if (item) item.isFavorite = !!res.data.isFavorite;
  filterMaterials();
}

async function openMaterialModal(id = '') {
  const old = id ? await API.post('materials/get', { id }) : null;
  if (id && (!old || !old.success)) { alert(old?.message || '자료를 불러오지 못했습니다.'); return; }
  const material = old?.data?.material || {};
  const expRes = await API.post('experiments/list');
  const experiments = expRes.success && Array.isArray(expRes.data) ? expRes.data : [];
  const overlay = document.createElement('div');
  overlay.id = 'material-edit-modal';
  overlay.className = 'fixed inset-0 z-[100] bg-slate-950/50 flex items-center justify-center p-3 sm:p-6';
  overlay.innerHTML = `
    <div class="bg-white w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl">
      <div class="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
        <div><h3 class="font-bold text-lg text-labit-text">${id ? '연구 자료 수정' : '새 연구 자료 등록'}</h3><p class="text-xs text-slate-500 mt-1">자료 정보를 입력해 주세요.</p></div>
        <button onclick="document.getElementById('material-edit-modal').remove()" class="p-2 text-slate-400 hover:text-slate-700"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <form id="material-edit-form" class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="sm:col-span-2 text-xs font-semibold text-slate-600">자료 제목 *
          <input name="title" required maxlength="200" value="${materialEscape(material.title || '')}" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </label>
        <label class="text-xs font-semibold text-slate-600">자료 유형
          <select name="type" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
            ${[['PAPER','논문'],['ARTICLE','기사'],['BOOK','도서'],['REPORT','보고서'],['ETC','기타']].map(([v,l])=>`<option value="${v}" ${material.type===v?'selected':''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="text-xs font-semibold text-slate-600">분야
          <select name="category" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
            ${['생명과학','의학','생명윤리','화학','인공지능','기타'].map(v=>`<option ${material.category===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </label>
        <label class="text-xs font-semibold text-slate-600">저자
          <input name="authors" value="${materialEscape(material.authors || '')}" placeholder="저자명" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </label>
        <label class="text-xs font-semibold text-slate-600">출처 / 발행처
          <input name="source" value="${materialEscape(material.source || '')}" placeholder="학술지, 언론사, 출판사 등" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </label>
        <label class="sm:col-span-2 text-xs font-semibold text-slate-600">자료 원문 링크
          <input name="url" type="url" value="${materialEscape(material.url || '')}" placeholder="https://" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </label>
        <label class="sm:col-span-2 text-xs font-semibold text-slate-600">DOI
          <input name="doi" value="${materialEscape(material.doi || '')}" placeholder="10.xxxx/xxxxx" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </label>
        <label class="sm:col-span-2 text-xs font-semibold text-slate-600">요약
          <textarea name="summary" rows="3" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">${materialEscape(material.summary || '')}</textarea>
        </label>
        <label class="sm:col-span-2 text-xs font-semibold text-slate-600">자료를 선정한 이유 / 활용 계획
          <textarea name="selectionReason" rows="3" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">${materialEscape(material.selectionReason || '')}</textarea>
        </label>
        <label class="sm:col-span-2 text-xs font-semibold text-slate-600">Google Drive 첨부 링크
          <input name="fileUrl" type="url" value="${materialEscape(material.fileUrl || '')}" placeholder="Drive 공유 링크(https://...)" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
          <span class="block mt-1 text-[10px] text-slate-400">파일을 Drive에 올린 뒤, 동아리원이 열람할 수 있는 공유 링크를 붙여 넣으세요.</span>
        </label>
        <label class="sm:col-span-2 text-xs font-semibold text-slate-600">연결할 실험
          <select name="relatedExperimentId" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
            <option value="">연결하지 않음</option>
            ${experiments.map(e=>`<option value="${materialEscape(e.id)}" ${String(material.relatedExperimentId||'')===String(e.id)?'selected':''}>${materialEscape(e.title)}</option>`).join('')}
          </select>
        </label>
        <div class="sm:col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" onclick="document.getElementById('material-edit-modal').remove()" class="px-4 py-2.5 text-xs font-bold text-slate-500 bg-slate-100 rounded-xl">취소</button>
          <button type="submit" class="px-5 py-2.5 text-xs font-bold text-white bg-labit-primary rounded-xl">${id ? '수정 내용 저장' : '자료 등록'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('material-edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form.entries());
    data.id = id;
    const result = await API.post(id ? 'materials/update' : 'materials/create', data);
    if (!result.success) { alert(result.message || '저장하지 못했습니다.'); return; }
    overlay.remove();
    await loadMaterials();
  });
}

async function openMaterialDetail(id) {
  const res = await API.post('materials/get', { id });
  if (!res.success) { alert(res.message || '자료를 불러오지 못했습니다.'); return; }
  const { material: m, comments } = res.data;
  const user = Auth.getUser();
  const canEdit = user && (user.role === 'ADMIN' || String(user.id) === String(m.authorId));
  const modal = document.createElement('div');
  modal.id = 'material-detail-modal';
  modal.className = 'fixed inset-0 z-[100] bg-slate-950/50 flex items-center justify-center p-3 sm:p-6';
  modal.innerHTML = `
    <div class="bg-white w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl">
      <div class="p-5 border-b border-slate-100 flex justify-between items-start gap-3">
        <div><div class="flex gap-2 mb-2"><span class="px-2 py-1 rounded-lg bg-emerald-50 text-labit-primary text-[10px] font-bold">${materialEscape(materialTypeLabel(m.type))}</span><span class="text-[10px] text-slate-500">${materialEscape(m.category || '기타')}</span></div><h3 class="text-lg font-bold text-labit-text">${materialEscape(m.title)}</h3><p class="text-xs text-slate-500 mt-2">${materialEscape(m.authors || '저자 정보 없음')} · ${materialEscape(m.source || '출처 정보 없음')}</p></div>
        <button onclick="document.getElementById('material-detail-modal').remove()" class="p-2 text-slate-400"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div class="p-5 space-y-5">
        ${(m.summary || m.content) ? `<section><h4 class="text-xs font-bold text-slate-500 mb-2">자료 요약 / 내용</h4><p class="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">${materialEscape(m.summary || m.content)}</p></section>` : ''}
        ${m.selectionReason ? `<section><h4 class="text-xs font-bold text-slate-500 mb-2">선정 이유 및 활용 계획</h4><p class="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">${materialEscape(m.selectionReason)}</p></section>` : ''}
        <section class="space-y-2 text-xs">
          ${m.doi ? `<p><b class="text-slate-500">DOI</b> <span class="text-slate-700">${materialEscape(m.doi)}</span></p>` : ''}
          ${m.url ? `<p><b class="text-slate-500">원문</b> <a href="${materialEscape(m.url)}" target="_blank" rel="noopener noreferrer" class="text-labit-primary underline break-all">자료 링크 열기</a></p>` : ''}
          ${m.fileUrl ? `<p><b class="text-slate-500">첨부</b> <a href="${materialEscape(m.fileUrl)}" target="_blank" rel="noopener noreferrer" class="text-labit-primary underline">Google Drive 파일 열기</a></p>` : ''}
          ${m.relatedExperimentId ? `<p><b class="text-slate-500">연결 실험</b> <span class="text-slate-700">${materialEscape((experimentsDataCache.find(e=>String(e.id)===String(m.relatedExperimentId))||{}).title || '연결된 실험')}</span></p>` : ''}
          <p class="text-slate-400">등록자: ${materialEscape(m.authorName || '동아리원')}</p>
        </section>
        <div class="flex flex-wrap gap-2">
          <button onclick="toggleMaterialFavorite('${materialEscape(m.id)}');document.getElementById('material-detail-modal')?.remove()" class="px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold">${m.isFavorite ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'}</button>
          ${canEdit ? `<button onclick="document.getElementById('material-detail-modal').remove();openMaterialModal('${materialEscape(m.id)}')" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">수정</button><button onclick="archiveMaterial('${materialEscape(m.id)}')" class="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-bold">보관</button>` : ''}
        </div>
        <section class="border-t border-slate-100 pt-4">
          <h4 class="font-bold text-sm text-labit-text mb-3">댓글 ${comments.length}</h4>
          <div class="space-y-3 mb-4">
            ${comments.length ? comments.map(c => `<div class="bg-slate-50 rounded-xl p-3"><div class="flex justify-between gap-2"><b class="text-xs text-slate-700">${materialEscape(c.authorName || '동아리원')}</b><span class="text-[10px] text-slate-400">${materialEscape(String(c.createdAt || '').slice(0,10))}</span></div><p class="text-xs text-slate-600 mt-2 whitespace-pre-wrap">${materialEscape(c.content)}</p>${user && (user.role==='ADMIN' || String(user.id)===String(c.authorId)) ? `<button onclick="archiveMaterialComment('${materialEscape(c.id)}','${materialEscape(m.id)}')" class="text-[10px] text-red-400 mt-2">댓글 삭제</button>` : ''}</div>`).join('') : '<p class="text-xs text-slate-400">아직 댓글이 없습니다.</p>'}
          </div>
          <form onsubmit="submitMaterialComment(event,'${materialEscape(m.id)}')" class="flex gap-2">
            <input id="material-comment-input" maxlength="3000" required placeholder="자료에 대한 의견을 남겨 보세요." class="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-xs">
            <button class="px-4 py-2.5 bg-labit-primary text-white text-xs font-bold rounded-xl">등록</button>
          </form>
        </section>
      </div>
    </div>`;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function archiveMaterial(id) {
  if (!confirm('이 자료를 보관할까요? 보관된 자료는 일반 목록에서 숨겨지며 시트의 기존 데이터는 삭제되지 않습니다.')) return;
  const res = await API.post('materials/archive', { id });
  if (!res.success) { alert(res.message || '보관하지 못했습니다.'); return; }
  document.getElementById('material-detail-modal')?.remove();
  await loadMaterials();
}

async function submitMaterialComment(event, materialId) {
  event.preventDefault();
  const input = document.getElementById('material-comment-input');
  const content = input?.value.trim();
  if (!content) return;
  const res = await API.post('materials/addComment', { materialId, content });
  if (!res.success) { alert(res.message || '댓글을 등록하지 못했습니다.'); return; }
  document.getElementById('material-detail-modal')?.remove();
  await openMaterialDetail(materialId);
}

async function archiveMaterialComment(id, materialId) {
  if (!confirm('댓글을 삭제할까요?')) return;
  const res = await API.post('materials/archiveComment', { id });
  if (!res.success) { alert(res.message || '댓글을 삭제하지 못했습니다.'); return; }
  document.getElementById('material-detail-modal')?.remove();
  await openMaterialDetail(materialId);
}

// ==========================================
// LABIT 추가 기능: 일정 / 동아리원 / 아카이브 / 커뮤니티
// ==========================================

window.LABIT = window.LABIT || {};
window.LABIT.formSave = null;

function labitEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[c]);
}

function labitCanManage(item, ownerField) {
  const user = Auth.getUser();
  return !!user && (
    user.role === 'ADMIN' ||
    String(item[ownerField]) === String(user.id)
  );
}

function labitOpenForm(title, fields, saveHandler) {
  window.LABIT.formSave = saveHandler;

  const modal = document.createElement('div');
  modal.id = 'labit-form-modal';
  modal.className = 'fixed inset-0 z-[110] bg-slate-950/50 flex items-center justify-center p-3';

  modal.innerHTML = `
    <div class="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
      <div class="p-5 border-b flex justify-between items-center">
        <h3 class="font-bold text-lg">${labitEscape(title)}</h3>
        <button onclick="labitCloseForm()" class="text-slate-400 p-2">
          <i data-lucide="x"></i>
        </button>
      </div>
      <form onsubmit="labitSubmitForm(event)" class="p-5 space-y-4">
        ${fields.map(f => `
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">${labitEscape(f.label)}</label>
            ${
              f.type === 'textarea'
                ? `<textarea name="${f.name}" maxlength="${f.maxlength || 5000}" ${f.required ? 'required' : ''} rows="4" class="w-full border rounded-xl p-3 text-sm">${labitEscape(f.value || '')}</textarea>`
                : f.type === 'select'
                  ? `<select name="${f.name}" class="w-full border rounded-xl p-3 text-sm">${f.options.map(o => `<option value="${labitEscape(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${labitEscape(o.label)}</option>`).join('')}</select>`
                  : `<input name="${f.name}" type="${f.type || 'text'}" value="${labitEscape(f.value || '')}" maxlength="${f.maxlength || 300}" ${f.required ? 'required' : ''} class="w-full border rounded-xl p-3 text-sm">`
            }
          </div>
        `).join('')}
        <div class="flex gap-2 pt-2">
          <button type="button" onclick="labitCloseForm()" class="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm">취소</button>
          <button type="submit" class="flex-1 py-3 rounded-xl bg-labit-primary text-white font-bold text-sm">저장</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => {
    if (e.target === modal) labitCloseForm();
  });
  if (window.lucide) lucide.createIcons();
}

function labitCloseForm() {
  document.getElementById('labit-form-modal')?.remove();
  window.LABIT.formSave = null;
}

async function labitSubmitForm(event) {
  event.preventDefault();
  const save = window.LABIT.formSave;
  if (!save) return;

  const data = Object.fromEntries(new FormData(event.target).entries());
  const button = event.target.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    await save(data);
  } catch (e) {
    alert(e.message || '저장 중 오류가 발생했습니다.');
    if (button) button.disabled = false;
  }
}

function labitEmpty(message) {
  return `<div class="text-center py-12 text-sm text-slate-400">${labitEscape(message)}</div>`;
}

function labitPageHeader(title, description, buttonText, onclick) {
  return `
    <div class="flex flex-wrap justify-between items-center gap-3 mb-6">
      <div>
        <h2 class="text-xl font-bold text-labit-text">${title}</h2>
        <p class="text-sm text-labit-subtext mt-1">${description}</p>
      </div>
      ${buttonText ? `<button onclick="${onclick}" class="px-4 py-2.5 rounded-xl bg-labit-primary text-white text-sm font-bold">${buttonText}</button>` : ''}
    </div>
  `;
}


// ==========================================
// 1. 일정 및 활동
// ==========================================

async function renderSchedulesView(container) {
  container.innerHTML = '<div class="py-16 text-center text-slate-400">일정을 불러오는 중...</div>';

  const res = await API.post('schedules/list');
  const schedules = res.success && Array.isArray(res.data) ? res.data : [];
  window.LABIT.schedules = schedules;

  container.innerHTML = `
    <div>
      ${labitPageHeader('일정 및 활동', '동아리의 모임과 주요 일정을 관리합니다.', '＋ 일정 등록', 'labitOpenSchedule()')}
      <div class="space-y-3">
        ${schedules.length ? schedules.map(s => `
          <div class="labit-card p-5">
            <div class="flex flex-wrap justify-between gap-3">
              <div class="min-w-0">
                <div class="text-xs text-labit-primary font-bold mb-2">${labitEscape(s.startDate || '날짜 미정')}${s.endDate ? ' ~ ' + labitEscape(s.endDate) : ''}</div>
                <h3 class="font-bold text-labit-text">${labitEscape(s.title)}</h3>
                <p class="text-sm text-slate-500 mt-2 whitespace-pre-wrap">${labitEscape(s.description || '')}</p>
                ${s.location ? `<p class="text-xs text-slate-400 mt-2">장소: ${labitEscape(s.location)}</p>` : ''}
              </div>
              ${labitCanManage(s, 'createdById') ? `
                <div class="flex gap-2">
                  <button onclick="labitEditSchedule('${encodeURIComponent(s.id)}')" class="text-xs text-slate-500">수정</button>
                  <button onclick="labitArchiveSchedule('${encodeURIComponent(s.id)}')" class="text-xs text-red-500">보관</button>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('') : labitEmpty('등록된 일정이 없습니다.')}
      </div>
    </div>
  `;
}

function labitOpenSchedule(id) {
  const old = id ? window.LABIT.schedules.find(s => String(s.id) === String(id)) : {};
  if (id && !old) return;

  labitOpenForm(id ? '일정 수정' : '새 일정 등록', [
    { name: 'title', label: '일정 제목', value: old.title, required: true },
    { name: 'startDate', label: '시작 날짜', type: 'date', value: old.startDate, required: true },
    { name: 'endDate', label: '종료 날짜', type: 'date', value: old.endDate },
    { name: 'location', label: '장소', value: old.location },
    { name: 'description', label: '상세 내용', type: 'textarea', value: old.description }
  ], async data => {
    const res = await API.post(id ? 'schedules/update' : 'schedules/create', {
      ...data, ...(id ? { id } : {})
    });
    if (!res.success) throw new Error(res.message || '일정을 저장하지 못했습니다.');
    labitCloseForm();
    await renderSchedulesView(document.getElementById('app-content'));
  });
}

function labitEditSchedule(id) {
  labitOpenSchedule(decodeURIComponent(id));
}

async function labitArchiveSchedule(id) {
  id = decodeURIComponent(id);
  if (!confirm('이 일정을 보관할까요?')) return;
  const res = await API.post('schedules/archive', { id });
  if (!res.success) return alert(res.message || '보관에 실패했습니다.');
  await renderSchedulesView(document.getElementById('app-content'));
}


// ==========================================
// 2. 동아리원 관리
// ==========================================

async function renderMembersView(container) {
  const user = Auth.getUser();

  if (!user || user.role !== 'ADMIN') {
    container.innerHTML = labitEmpty('관리자만 동아리원 관리 화면에 접근할 수 있습니다.');
    return;
  }

  container.innerHTML = '<div class="py-16 text-center text-slate-400">동아리원 정보를 불러오는 중...</div>';

  const res = await API.post('members/list');
  const members = res.success && Array.isArray(res.data) ? res.data : [];
  window.LABIT.members = members;

  container.innerHTML = `
    <div>
      ${labitPageHeader('동아리원 관리', '가입된 동아리원의 계정과 권한을 관리합니다.', '＋ 동아리원 초대', 'labitInviteMember()')}
      <div class="labit-card overflow-hidden">
        ${members.length ? members.map(m => `
          <div class="p-4 border-b border-slate-100 last:border-0 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-labit-primary font-bold">
                ${labitEscape((m.name || '?').slice(0, 1))}
              </div>
              <div class="min-w-0">
                <p class="font-bold text-sm text-labit-text">${labitEscape(m.name)}</p>
                <p class="text-xs text-slate-400 truncate">${labitEscape(m.email)}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs px-2 py-1 rounded-lg ${m.role === 'ADMIN' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${m.role === 'ADMIN' ? '관리자' : '일반 회원'}</span>
              <span class="text-xs ${m.status === 'ACTIVE' ? 'text-emerald-600' : 'text-red-500'}">${m.status === 'ACTIVE' ? '활성' : '비활성'}</span>
              <button onclick="labitEditMember('${encodeURIComponent(m.id)}')" class="text-xs text-labit-primary font-bold">관리</button>
            </div>
          </div>
        `).join('') : labitEmpty('등록된 동아리원이 없습니다.')}
      </div>
    </div>
  `;
}

function labitInviteMember() {
  labitOpenForm('동아리원 초대', [
    { name: 'name', label: '이름', required: true },
    { name: 'email', label: '학교 이메일', type: 'email', required: true },
    { name: 'role', label: '권한', type: 'select', value: 'MEMBER', options: [
      { value: 'MEMBER', label: '일반 회원' },
      { value: 'ADMIN', label: '관리자' }
    ]}
  ], async data => {
    const res = await API.post('members/invite', data);
    if (!res.success) throw new Error(res.message || '초대에 실패했습니다.');
    alert('초대가 등록되었습니다.');
    labitCloseForm();
    await renderMembersView(document.getElementById('app-content'));
  });
}

function labitEditMember(id) {
  id = decodeURIComponent(id);
  const member = window.LABIT.members.find(m => String(m.id) === String(id));
  if (!member) return;

  labitOpenForm('동아리원 정보 변경', [
    { name: 'role', label: '권한', type: 'select', value: member.role, options: [
      { value: 'MEMBER', label: '일반 회원' },
      { value: 'ADMIN', label: '관리자' }
    ]},
    { name: 'status', label: '계정 상태', type: 'select', value: member.status, options: [
      { value: 'ACTIVE', label: '활성' },
      { value: 'INACTIVE', label: '비활성' }
    ]}
  ], async data => {
    const res = await API.post('members/update', { id, ...data });
    if (!res.success) throw new Error(res.message || '회원 정보를 변경하지 못했습니다.');
    labitCloseForm();
    await renderMembersView(document.getElementById('app-content'));
  });
}


// ==========================================
// 3. 활동 아카이브
// ==========================================

async function renderArchiveView(container) {
  container.innerHTML = '<div class="py-16 text-center text-slate-400">활동 기록을 불러오는 중...</div>';

  const res = await API.post('archive/list');
  const data = res.success && res.data ? res.data : {};
  const activities = data.activities || [];
  const experiments = data.completedExperiments || [];

  container.innerHTML = `
    <div>
      ${labitPageHeader('활동 아카이브', '완료된 실험과 동아리 활동을 모아 봅니다.', '＋ 활동 기록', 'labitOpenActivity()')}

      <section class="mb-8">
        <h3 class="font-bold text-labit-text mb-3">완료된 실험</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${experiments.length ? experiments.map(e => `
            <div class="labit-card p-4">
              <span class="text-xs text-emerald-600 font-bold">실험 완료</span>
              <h4 class="font-bold mt-2">${labitEscape(e.title)}</h4>
              <p class="text-xs text-slate-400 mt-2">${labitEscape(e.category || '기타')}</p>
              <button onclick="navigateTo('experiments')" class="text-xs text-labit-primary mt-3">실험 관리에서 보기 →</button>
            </div>
          `).join('') : labitEmpty('완료된 실험이 없습니다.')}
        </div>
      </section>

      <section>
        <h3 class="font-bold text-labit-text mb-3">동아리 활동 기록</h3>
        <div class="space-y-3">
          ${activities.length ? activities.map(a => `
            <div class="labit-card p-5">
              <div class="flex justify-between gap-3">
                <div>
                  <p class="text-xs text-labit-primary font-bold">${labitEscape(a.activityDate || '날짜 미정')}</p>
                  <h4 class="font-bold mt-2">${labitEscape(a.title)}</h4>
                  <p class="text-sm text-slate-500 mt-2 whitespace-pre-wrap">${labitEscape(a.description || '')}</p>
                  <p class="text-xs text-slate-400 mt-2">참여 인원 ${Number(a.memberCount) || 0}명</p>
                </div>
                ${labitCanManage(a, 'authorId') ? `
                  <div class="flex gap-2 shrink-0">
                    <button onclick="labitEditActivity('${encodeURIComponent(a.id)}')" class="text-xs text-slate-500">수정</button>
                    <button onclick="labitArchiveActivity('${encodeURIComponent(a.id)}')" class="text-xs text-red-500">보관</button>
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('') : labitEmpty('등록된 활동 기록이 없습니다.')}
        </div>
      </section>
    </div>
  `;
}

function labitOpenActivity(id) {
  const old = id ? (window.LABIT.activities || []).find(a => String(a.id) === String(id)) : {};
  labitOpenForm(id ? '활동 기록 수정' : '새 활동 기록', [
    { name: 'title', label: '활동 제목', value: old.title, required: true },
    { name: 'activityDate', label: '활동 날짜', type: 'date', value: old.activityDate },
    { name: 'memberCount', label: '참여 인원', type: 'number', value: old.memberCount || 0 },
    { name: 'description', label: '활동 내용', type: 'textarea', value: old.description }
  ], async data => {
    const res = await API.post(id ? 'activities/update' : 'activities/create', {
      ...data, ...(id ? { id } : {})
    });
    if (!res.success) throw new Error(res.message || '활동 기록을 저장하지 못했습니다.');
    labitCloseForm();
    await renderArchiveView(document.getElementById('app-content'));
  });
}

async function labitEditActivity(id) {
  id = decodeURIComponent(id);
  const res = await API.post('activities/list');
  window.LABIT.activities = res.success ? res.data || [] : [];
  labitOpenActivity(id);
}

async function labitArchiveActivity(id) {
  id = decodeURIComponent(id);
  if (!confirm('이 활동 기록을 보관할까요?')) return;
  const res = await API.post('activities/archive', { id });
  if (!res.success) return alert(res.message || '보관에 실패했습니다.');
  await renderArchiveView(document.getElementById('app-content'));
}


// ==========================================
// 4. 공지 및 커뮤니티
// ==========================================

async function renderCommunityView(container) {
  container.innerHTML = '<div class="py-16 text-center text-slate-400">게시글을 불러오는 중...</div>';

  const res = await API.post('community/list');
  const posts = res.success && Array.isArray(res.data) ? res.data : [];
  window.LABIT.posts = posts;

  container.innerHTML = `
    <div>
      ${labitPageHeader('공지 및 커뮤니티', '동아리 공지사항과 자유로운 의견을 나눕니다.', '＋ 글쓰기', 'labitOpenPost()')}
      <div class="space-y-3">
        ${posts.length ? posts.map(p => `
          <button onclick="labitOpenPostDetail('${encodeURIComponent(p.id)}')" class="labit-card p-5 w-full text-left hover:border-emerald-200">
            <div class="flex justify-between gap-3">
              <div class="min-w-0">
                <span class="text-xs text-labit-primary font-bold">${labitEscape(p.category || '자유')}</span>
                <h3 class="font-bold text-labit-text mt-2 truncate">${labitEscape(p.title)}</h3>
                <p class="text-xs text-slate-400 mt-2">${labitEscape(p.authorName || '동아리원')} · ${labitEscape(String(p.createdAt || '').slice(0, 10))}</p>
              </div>
              <i data-lucide="chevron-right" class="w-5 h-5 text-slate-300 shrink-0"></i>
            </div>
          </button>
        `).join('') : labitEmpty('등록된 게시글이 없습니다.')}
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function labitOpenPost(id) {
  const old = id ? window.LABIT.posts.find(p => String(p.id) === String(id)) : {};

  labitOpenForm(id ? '게시글 수정' : '새 게시글 작성', [
    { name: 'title', label: '제목', value: old.title, required: true },
    { name: 'category', label: '분류', type: 'select', value: old.category || '자유', options: [
      { value: '공지', label: '공지' },
      { value: '자유', label: '자유' },
      { value: '질문', label: '질문' },
      { value: '활동', label: '활동' }
    ]},
    { name: 'content', label: '내용', type: 'textarea', value: old.content, required: true, maxlength: 10000 }
  ], async data => {
    const res = await API.post(id ? 'community/update' : 'community/create', {
      ...data, ...(id ? { id } : {})
    });
    if (!res.success) throw new Error(res.message || '게시글을 저장하지 못했습니다.');
    labitCloseForm();
    await renderCommunityView(document.getElementById('app-content'));
  });
}

async function labitOpenPostDetail(id) {
  id = decodeURIComponent(id);
  const res = await API.post('community/get', { id });
  if (!res.success) return alert(res.message || '게시글을 불러오지 못했습니다.');

  const { post, comments } = res.data;
  const user = Auth.getUser();
  const canEdit = user && (
    user.role === 'ADMIN' || String(user.id) === String(post.authorId)
  );

  document.getElementById('labit-post-detail')?.remove();

  const modal = document.createElement('div');
  modal.id = 'labit-post-detail';
  modal.className = 'fixed inset-0 z-[100] bg-slate-950/50 flex items-center justify-center p-3';

  modal.innerHTML = `
    <div class="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
      <div class="p-5 border-b flex justify-between gap-3">
        <div>
          <span class="text-xs text-labit-primary font-bold">${labitEscape(post.category || '자유')}</span>
          <h3 class="font-bold text-lg mt-2">${labitEscape(post.title)}</h3>
          <p class="text-xs text-slate-400 mt-2">${labitEscape(post.authorName || '동아리원')} · ${labitEscape(String(post.createdAt || '').slice(0, 10))}</p>
        </div>
        <button onclick="document.getElementById('labit-post-detail')?.remove()" class="text-slate-400 p-2"><i data-lucide="x"></i></button>
      </div>
      <div class="p-5">
        <p class="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">${labitEscape(post.content)}</p>

        ${canEdit ? `
          <div class="flex gap-2 mt-5">
            <button onclick="document.getElementById('labit-post-detail')?.remove();labitOpenPost('${encodeURIComponent(post.id)}')" class="text-xs bg-slate-100 rounded-lg px-3 py-2">수정</button>
            <button onclick="labitArchivePost('${encodeURIComponent(post.id)}')" class="text-xs bg-red-50 text-red-600 rounded-lg px-3 py-2">보관</button>
          </div>
        ` : ''}

        <div class="border-t mt-6 pt-5">
          <h4 class="font-bold text-sm mb-3">댓글 ${comments.length}개</h4>
          <div class="space-y-3">
            ${comments.map(c => `
              <div class="bg-slate-50 p-3 rounded-xl">
                <p class="text-xs font-bold">${labitEscape(c.authorName || '동아리원')}</p>
                <p class="text-sm mt-2 whitespace-pre-wrap">${labitEscape(c.content)}</p>
                ${user && (user.role === 'ADMIN' || String(user.id) === String(c.authorId)) ? `<button onclick="labitArchivePostComment('${encodeURIComponent(c.id)}','${encodeURIComponent(post.id)}')" class="text-xs text-red-500 mt-2">댓글 삭제</button>` : ''}
              </div>
            `).join('') || '<p class="text-xs text-slate-400">아직 댓글이 없습니다.</p>'}
          </div>
          <form onsubmit="labitSubmitPostComment(event,'${encodeURIComponent(post.id)}')" class="flex gap-2 mt-4">
            <input name="content" maxlength="3000" required placeholder="댓글을 입력하세요." class="flex-1 min-w-0 border rounded-xl px-3 py-2 text-sm">
            <button class="bg-labit-primary text-white rounded-xl px-4 text-sm font-bold">등록</button>
          </form>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });
  if (window.lucide) lucide.createIcons();
}

async function labitSubmitPostComment(event, id) {
  event.preventDefault();
  id = decodeURIComponent(id);
  const content = new FormData(event.target).get('content');
  const res = await API.post('community/addComment', { postId: id, content });
  if (!res.success) return alert(res.message || '댓글을 등록하지 못했습니다.');
  await labitOpenPostDetail(encodeURIComponent(id));
}

async function labitArchivePost(id) {
  id = decodeURIComponent(id);
  if (!confirm('게시글을 보관할까요?')) return;
  const res = await API.post('community/archive', { id });
  if (!res.success) return alert(res.message || '게시글을 보관하지 못했습니다.');
  document.getElementById('labit-post-detail')?.remove();
  await renderCommunityView(document.getElementById('app-content'));
}

async function labitArchivePostComment(commentId, postId) {
  commentId = decodeURIComponent(commentId);
  postId = decodeURIComponent(postId);
  if (!confirm('댓글을 삭제할까요?')) return;
  const res = await API.post('community/archiveComment', { id: commentId });
  if (!res.success) return alert(res.message || '댓글을 삭제하지 못했습니다.');
  await labitOpenPostDetail(encodeURIComponent(postId));
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
