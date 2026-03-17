const FIRST_NAMES_MALE = [
  "james","john","robert","michael","david","william","richard","joseph",
  "thomas","christopher","charles","daniel","matthew","anthony","mark",
  "donald","steven","andrew","paul","joshua","kenneth","kevin","brian",
  "george","timothy","ronald","edward","jason","jeffrey","ryan","jacob",
  "gary","nicholas","eric","jonathan","stephen","larry","justin","scott",
  "brandon","benjamin","samuel","raymond","gregory","frank","alexander",
  "patrick","jack","dennis","jerry","tyler","aaron","nathan","henry",
];

const FIRST_NAMES_FEMALE = [
  "mary","patricia","jennifer","linda","barbara","elizabeth","susan",
  "jessica","sarah","karen","lisa","nancy","betty","margaret","sandra",
  "ashley","dorothy","kimberly","emily","donna","michelle","carol",
  "amanda","melissa","deborah","stephanie","rebecca","sharon","laura",
  "cynthia","kathleen","amy","angela","shirley","anna","brenda","pamela",
  "emma","nicole","helen","samantha","katherine","christine","rachel",
  "carolyn","janet","catherine","maria","heather","diane","ruth","julie",
  "olivia","joyce","virginia","victoria","kelly","lauren","christina",
];

const LAST_NAMES = [
  "smith","johnson","williams","brown","jones","garcia","miller","davis",
  "rodriguez","martinez","hernandez","lopez","gonzalez","wilson","anderson",
  "thomas","taylor","moore","jackson","martin","lee","perez","thompson",
  "white","harris","sanchez","clark","ramirez","lewis","robinson","walker",
  "young","allen","king","wright","scott","torres","nguyen","hill","flores",
  "green","adams","nelson","baker","hall","rivera","campbell","mitchell",
  "carter","roberts",
];

// Alamat Korea Selatan — data nyata (jalan, kota, provinsi, kode pos)
const KOREAN_ADDRESSES = [
  { line1: "123 Teheran-ro", city: "Seoul", district: "Gangnam-gu", province: "Seoul", postal: "06170" },
  { line1: "456 Bongeunsa-ro", city: "Seoul", district: "Gangnam-gu", province: "Seoul", postal: "06103" },
  { line1: "78 Hongik-ro", city: "Seoul", district: "Mapo-gu", province: "Seoul", postal: "04066" },
  { line1: "234 Yonsei-ro", city: "Seoul", district: "Seodaemun-gu", province: "Seoul", postal: "03722" },
  { line1: "12 Insadong-gil", city: "Seoul", district: "Jongno-gu", province: "Seoul", postal: "03158" },
  { line1: "567 Banpo-daero", city: "Seoul", district: "Seocho-gu", province: "Seoul", postal: "06594" },
  { line1: "89 Jamsil-ro", city: "Seoul", district: "Songpa-gu", province: "Seoul", postal: "05510" },
  { line1: "321 Sinchon-ro", city: "Seoul", district: "Seodaemun-gu", province: "Seoul", postal: "03785" },
  { line1: "654 Itaewon-ro", city: "Seoul", district: "Yongsan-gu", province: "Seoul", postal: "04349" },
  { line1: "11 Dongdaemun-daero", city: "Seoul", district: "Junggu", province: "Seoul", postal: "04566" },
  { line1: "789 Haeundae-ro", city: "Busan", district: "Haeundae-gu", province: "Busan", postal: "48094" },
  { line1: "456 Seomyeon-ro", city: "Busan", district: "Busanjin-gu", province: "Busan", postal: "47294" },
  { line1: "123 Gwangbok-ro", city: "Busan", district: "Junggu", province: "Busan", postal: "48944" },
  { line1: "234 Dongseong-ro", city: "Daegu", district: "Junggu", province: "Daegu", postal: "41944" },
  { line1: "567 Suseong-ro", city: "Daegu", district: "Suseong-gu", province: "Daegu", postal: "42024" },
  { line1: "88 Bupyeong-daero", city: "Incheon", district: "Bupyeong-gu", province: "Incheon", postal: "21564" },
  { line1: "345 Songdo-daero", city: "Incheon", district: "Yeonsu-gu", province: "Incheon", postal: "21984" },
  { line1: "190 Chungjeong-ro", city: "Daejeon", district: "Seogu", province: "Daejeon", postal: "35270" },
  { line1: "78 Dunsan-ro", city: "Daejeon", district: "Seogu", province: "Daejeon", postal: "35220" },
  { line1: "456 Gwanggyo-ro", city: "Suwon", district: "Yeongtong-gu", province: "Gyeonggi-do", postal: "16506" },
  { line1: "123 Paldal-ro", city: "Suwon", district: "Paldal-gu", province: "Gyeonggi-do", postal: "16488" },
  { line1: "67 Jungang-daero", city: "Gwangju", district: "Donggu", province: "Gwangju", postal: "61471" },
  { line1: "234 Namdaejeon-ro", city: "Daejeon", district: "Yuseong-gu", province: "Daejeon", postal: "34134" },
  { line1: "89 Taehwa-ro", city: "Ulsan", district: "Junggu", province: "Ulsan", postal: "44535" },
  { line1: "12 Sejong-daero", city: "Sejong", district: "Sejongsi", province: "Chungcheongnam-do", postal: "30151" },
];

function randItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function generateRandomName(): { firstName: string; lastName: string } {
  const allFirstNames = [...FIRST_NAMES_MALE, ...FIRST_NAMES_FEMALE];
  return {
    firstName: capitalize(randItem(allFirstNames)),
    lastName: capitalize(randItem(LAST_NAMES)),
  };
}

export function generateRandomBirthday(): string {
  const year = 1990 + Math.floor(Math.random() * 13); // 1990–2002
  const month = 1 + Math.floor(Math.random() * 12);   // 1–12
  const day = 1 + Math.floor(Math.random() * 28);     // 1–28
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${mm}/${dd}/${year}`;
}

export function generateEmailPrefix(firstName: string, lastName: string): string {
  const patterns = [
    () => `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 900 + 100)}`,
    () => `${firstName.toLowerCase()[0]}${lastName.toLowerCase()}${Math.floor(Math.random() * 90 + 10)}`,
    () => `${firstName.toLowerCase()}${Math.floor(Math.random() * 9000 + 1000)}`,
    () => `${firstName.toLowerCase()}_${lastName.toLowerCase()}${Math.floor(Math.random() * 99 + 1)}`,
    () => `${firstName.toLowerCase()}${lastName.toLowerCase()[0]}${Math.floor(Math.random() * 999 + 100)}`,
  ];
  const fn = patterns[Math.floor(Math.random() * patterns.length)];
  return fn();
}

export function generatePassword(): string {
  return "Ppsmmgl@1919";
}

export interface KoreanAddress {
  line1: string;
  city: string;
  district: string;
  province: string;
  postal: string;
  country: string;
  countryCode: string;
}

export function generateKoreanAddress(): KoreanAddress {
  const addr = randItem(KOREAN_ADDRESSES);
  return {
    ...addr,
    country: "South Korea",
    countryCode: "KR",
  };
}

export interface CreditCardInfo {
  expMonth: string;
  expYear: string;
  cvv: string;
}

export function generateCreditCardInfo(): CreditCardInfo {
  const expMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const expYear = String(2034 + Math.floor(Math.random() * 8)); // 2034–2041
  const cvv = String(Math.floor(Math.random() * 900) + 100); // 100–999
  return { expMonth, expYear, cvv };
}
