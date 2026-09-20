import { validateSourceFields } from './sources.mjs';

export const CANONICAL_PROJECT_INTAKE = Object.freeze([
  {
    "code": "C00",
    "title": "PortfolioOps — Master Control",
    "entityType": "SYS",
    "summary": "PortfolioOps 핵심 운영·기억·프로젝트 제어면. canonical intake이며 제품 완료를 뜻하지 않는다.",
    "implementationStatus": "idea"
  },
  {
    "code": "C01",
    "title": "Buzz HQ — Opportunity Intelligence",
    "entityType": "OPS",
    "summary": "Buzz/PortfolioOps 기회 탐색·인텔리전스 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "E01",
    "title": "EUREKA — AMR / EARS-Net",
    "entityType": "RND",
    "summary": "항생제 내성 공개 데이터 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E02",
    "title": "EUREKA — Long COVID",
    "entityType": "RND",
    "summary": "Long COVID 공개 근거 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E03",
    "title": "EUREKA — AGING",
    "entityType": "RND",
    "summary": "노화·건강 공개 근거 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E04",
    "title": "EUREKA — CDR",
    "entityType": "RND",
    "summary": "CDR 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E05",
    "title": "EUREKA — Battery Safety",
    "entityType": "RND",
    "summary": "배터리 안전 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E06",
    "title": "EUREKA — Climate Migration Health",
    "entityType": "RND",
    "summary": "기후 이동과 건강 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E07",
    "title": "EUREKA — Pandemic Intelligence",
    "entityType": "RND",
    "summary": "팬데믹 인텔리전스 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E08",
    "title": "EUREKA — Materials Generalization",
    "entityType": "RND",
    "summary": "재료 일반화 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "E09",
    "title": "EUREKA — Global Health Data Gaps",
    "entityType": "RND",
    "summary": "글로벌 헬스 데이터 공백 연구 트랙.",
    "implementationStatus": "idea"
  },
  {
    "code": "V01",
    "title": "Venture — Shopify Payout Exception Resolver",
    "entityType": "APP",
    "summary": "Shopify 지급 예외 대조 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V02",
    "title": "Venture — AccountShift Audit",
    "entityType": "APP",
    "summary": "AccountShift 감사 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V03",
    "title": "Venture — Prediction Market Shadow / Bonereaper",
    "entityType": "RND",
    "summary": "예측시장·Bonereaper shadow/paper 분석 후보. 실거래 아님.",
    "implementationStatus": "idea"
  },
  {
    "code": "V04",
    "title": "Venture — Roleplay → Orbiter → orbiter2 → 존재의 구조적 해부",
    "entityType": "APP",
    "summary": "Roleplay·Orbiter 계보 보존 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V05",
    "title": "Venture — PangPang Diffuser",
    "entityType": "HW",
    "summary": "PangPang diffuser 하드웨어·제품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V06",
    "title": "Venture — Makgeolli App",
    "entityType": "APP",
    "summary": "막걸리 앱 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V07",
    "title": "Venture — KBO Fandom Platform",
    "entityType": "APP",
    "summary": "KBO 팬덤 플랫폼 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V08",
    "title": "Venture — S-grade Niche Discovery",
    "entityType": "OPS",
    "summary": "틈새시장 발견·검증 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V09",
    "title": "Venture — 역사 바꾸는 게임",
    "entityType": "IP",
    "summary": "역사 선택형 게임 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V10",
    "title": "Venture — Re:Memoir",
    "entityType": "IP",
    "summary": "Re:Memoir 기록·콘텐츠 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "A01",
    "title": "For-Ai",
    "entityType": "APP",
    "summary": "AI 검색 노출·출처 점검 서비스 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "A02",
    "title": "Yeogie — Physical Web / Place Memory Network",
    "entityType": "APP",
    "summary": "장소 기억·물리 웹 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "A03",
    "title": "한끼안부",
    "entityType": "APP",
    "summary": "한끼안부 로컬 프로토타입 후보. 로컬 시험 이력은 실제 서비스 완료가 아니다.",
    "implementationStatus": "tested"
  },
  {
    "code": "A04",
    "title": "계절·24절기(+사주)",
    "entityType": "APP",
    "summary": "계절·24절기·사주 콘텐츠 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "A05",
    "title": "GYEOL — Self-Growing AI Companion",
    "entityType": "APP",
    "summary": "자기 성장형 AI companion 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B01",
    "title": "PRAY FOR ME",
    "entityType": "IP",
    "summary": "기도·위로 콘텐츠와 커뮤니티 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B02",
    "title": "ShoppingShorts — HQ",
    "entityType": "APP",
    "summary": "ShoppingShorts 상위 운영 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B02-1",
    "title": "ShoppingShorts — Toss Shopping Sharelink",
    "entityType": "APP",
    "summary": "Toss 쇼핑 공유 링크 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B02-2",
    "title": "ShoppingShorts — Toss 맛집 크리에이터",
    "entityType": "APP",
    "summary": "Toss 맛집 크리에이터 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B02-3",
    "title": "ShoppingShorts — Daum Channel Studio",
    "entityType": "APP",
    "summary": "Daum 채널 스튜디오 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B02-4",
    "title": "ShoppingShorts — AI Shorts Production Engine",
    "entityType": "APP",
    "summary": "AI 숏폼 로컬 렌더 후보. 외부 게시·수익화 완료가 아니다.",
    "implementationStatus": "tested"
  },
  {
    "code": "B02-5",
    "title": "ShoppingShorts — Product Discovery / Validation",
    "entityType": "OPS",
    "summary": "상품 발견·검증 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B02-6",
    "title": "ShoppingShorts — Multichannel Distribution",
    "entityType": "OPS",
    "summary": "멀티채널 배포 후보. 실제 게시에는 승인 필요.",
    "implementationStatus": "idea"
  },
  {
    "code": "B03",
    "title": "Sports3D — Original 55mm Motion Collectible",
    "entityType": "IP",
    "summary": "55mm 스포츠 모션 수집품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04",
    "title": "Fiction / Character / Story IP Studio — HQ",
    "entityType": "IP",
    "summary": "소설·캐릭터·스토리 IP 운영 본부 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-01",
    "title": "F-01 천하제일 야구검객",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-02",
    "title": "F-02 중국통일 / 대만통일",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-03",
    "title": "F-03 조상님이 보고계셔",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-04",
    "title": "F-04 태어나보니 북한사람",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-05",
    "title": "F-05 태어나보니 친일 / 대한독립",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-06",
    "title": "F-06 전생에 암행어사, 현생엔 감사팀",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-07",
    "title": "F-07 나라를 잃어본 왕세자",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-08",
    "title": "F-08 귀신들이 사는 아파트",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-09",
    "title": "F-09 조선 최고의 의원, 응급실에 떨어지다",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-10",
    "title": "F-10 미래의 후손들이 나를 구독했다",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-11",
    "title": "꽁몽이",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-12",
    "title": "배불배불 배불이",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "B04-13",
    "title": "만화덕후 이세계",
    "entityType": "IP",
    "summary": "B04 소설/IP 작품 후보.",
    "implementationStatus": "idea"
  },
  {
    "code": "V11",
    "title": "BLACKHOLE 기록실 — 검색 추리 게임",
    "entityType": "IP",
    "summary": "검색·추리 게임 레지스트리 후보. 플레이본은 제품 배포 완료가 아니다.",
    "implementationStatus": "idea"
  }
]);

const key = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
const names = source => [source.title, source.sourceLocator, ...(source.aliases ?? [])].map(key).filter(Boolean);

export function planCanonicalProjectIntake(existing) {
  if (!Array.isArray(existing)) throw new TypeError('existing sources must be an array');
  const occupied = new Set(existing.flatMap(names));
  const plans = [];
  for (const entry of CANONICAL_PROJECT_INTAKE) {
    const aliases = [entry.code];
    const candidateNames = [entry.code, entry.title];
    if (candidateNames.some(name => occupied.has(key(name)))) continue;
    const fields = validateSourceFields({
      sourceLocator: entry.title,
      title: entry.title,
      aliases,
      entityType: entry.entityType,
      implementationStatus: entry.implementationStatus,
      origin: 'user',
      summary: entry.summary,
    }, { creating: true, imported: true });
    plans.push(fields);
  }
  return plans;
}
