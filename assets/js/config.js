/**
 * LABIT - 글로벌 설정 및 환경 변수
 */
window.CONFIG = {
  APP_NAME: 'LABIT',
  VERSION: '1.0.0',
  ALLOWED_DOMAIN: 'yanggok.hs.kr',
  
  // GAS Web App 배포 URL
  GAS_API_URL: 'https://labit-api.ayden090410.workers.dev',
  
  // Google OAuth 2.0 Client ID
  GOOGLE_CLIENT_ID: '20979828869-0mbv7uonhcdu9ivdgntkcdg8k3hb4msr.apps.googleusercontent.com'
};

// 호환성을 위한 하위 참조 변수
const CONFIG = window.CONFIG;

/**
 * 기본 9개 메뉴 데이터 구조 및 접근 권한 설정
 */
window.MENU_ITEMS = [
  { id: 'dashboard', name: '대시보드', icon: 'layout-dashboard', implemented: true, minRole: 'MEMBER' },
  { id: 'experiments', name: '실험 관리', icon: 'flask-conical', implemented: true, minRole: 'MEMBER' },
  { id: 'materials', name: '연구 자료실', icon: 'book-open', implemented: true, minRole: 'MEMBER' },
  { id: 'schedules', name: '일정 및 활동', icon: 'calendar', implemented: false, minRole: 'MEMBER' },
  { id: 'members', name: '동아리원 관리', icon: 'users', implemented: false, minRole: 'ADMIN' },
  { id: 'archive', name: '활동 아카이브', icon: 'archive', implemented: false, minRole: 'MEMBER' },
  { id: 'community', name: '공지 및 커뮤니티', icon: 'message-square', implemented: false, minRole: 'MEMBER' },
  { id: 'manual', name: '사용 방법', icon: 'help-circle', implemented: false, minRole: 'GUEST' },
  { id: 'admin', name: '관리자 설정', icon: 'settings', implemented: true, minRole: 'ADMIN' }
];

const MENU_ITEMS = window.MENU_ITEMS;
// 관리자가 브라우저에서 변경한 비밀이 아닌 연결 설정을 복원한다.
try {
  const saved = JSON.parse(localStorage.getItem('labit_public_config') || '{}');
  if (saved.GAS_API_URL) window.CONFIG.GAS_API_URL = saved.GAS_API_URL;
  if (saved.GOOGLE_CLIENT_ID) window.CONFIG.GOOGLE_CLIENT_ID = saved.GOOGLE_CLIENT_ID;
} catch (e) { console.warn('[LABIT] 저장된 공개 설정을 읽지 못했습니다.', e); }
window.CONFIG.GAS_API_URL = String(window.CONFIG.GAS_API_URL || '').trim();
