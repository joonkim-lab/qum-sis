# qum-sis 인수인계 (2026-10-24, v32)

## 현재 상태
- 앱: https://joonkim-lab.github.io/qum-sis/ (GitHub Pages, 저장소 joonkim-lab/qum-sis, 단일 index.html + firestore.rules + data/)
- DB: Firebase 프로젝트 `qum-sis` (educclesia 계정), Firestore, Google 로그인. 소유자 joon.kim@educclesia.com
- v32까지 push 완료(2026-10-24 23:39, 집 맥북 ~/qum-sis에서). Firestore 규칙도 sections/progress/biweekly 포함본으로 콘솔 게시 완료(10/24 23:05)
- 화면: 현황 · 학생(정보/성적/출결·징계/수상·활동/Transcript/학습성장기록부) · 과목 · 출결 입력 · **반·진도** · **출결 확인서** · 슬립 승인 · 세특 · 수정 요청 · 신입생 등록 · 가져오기 · 학교 설정
- 새 대화에서는 저장소 clone(또는 맥미니 로컬) → index.html 읽고 시작

## 10/24 추가된 것 (v30~v32)
- **반(sections)**: 담임반(house)만 사용. 학년당 1반 = 하우스. `house_2026F_{middle-school|freshman|sophomore|junior|senior}`. 담임: Middle School onyou.na · Freshman jeein.kang · Sophomore julie.cho · Junior eunji.ahn · Senior jin.kim (@eliteopenschool.org)
  - 과목반 자동 생성은 폐기(Apex 과목 교사는 본사 쪽, 진도 확인은 담임 몫). 교내 선택과목 등은 "반 직접 추가"로만
- **진도 상태(progress)**: 담임반 화면 = 학생×과목 격자 + "미리 (전 과목)" 한 줄. 상태 3단계 On Track / Behind (5–10) / Behind (10+)
  - Apex/Buzz 과목은 grades의 Genius 스냅샷(`behind`, `auto`, `score`, `geniusAsOf`)으로 자동. 0–4 On Track, 5–10 Behind, 11+ Behind 10+. 담임이 누른 값이 geniusAsOf 이후 날짜면 그게 우선
  - 미리 줄은 담임이 직접
- **격주 출결 확인서(biweekly)**: 담임반·기간(기본 최근 14일) → 학생별 A4 반장×2. 이번 2주 + 학기 누적 EA/ET/UA/UT, 과목별 현재 점수·상태·메모, 담임 의견(그 자리에서 입력, biweekly/{반}_{종료일}에 저장), 학생·학부모·담임 서명. **주소 뺌**(준킴쌤 결정). 9과목까지 반장에 맞춤
- **Genius 이번 학기 수강 반영(10/24)**: Genius Enrollments → Basic Search(Status ACTIVE) → Get Data 표 276건을 긁어 2026F grades에 반영(기존 182줄 업데이트, 94줄 신규, needsReview=true, importedBy=genius-enrollments). 학생 49명 전원 이름 매칭(Park Soyun 2명은 과목 수준으로 구분: 4236 중등 / 805 고3)
  - 2주마다 갱신 필요: Genius 로그인 상태에서 같은 표를 긁어 score/behind/auto/geniusAsOf 업데이트. 지금은 클로드가 크롬으로 수행(행정용 버튼은 미구현)
  - Genius 페이지는 JS 실행 권한 없음 → get_page_text로 읽음. SIS 페이지에서는 콘솔 JS로 firebase 모듈 dynamic import해서 직접 쓰기 가능

## 확정 규칙
- ID = Genius ID, 신입생 9001부터
- 학기 코드 2026F/2026S/2026U 저장, 출력 "Fall 2026-27". 8월 이후=F, 1~7월=S
- GPA = 학점 가중 평균 (A4 B3 C2 D1 F0 / 가중 A5 B4 C3 D2 F1.7)
- 학점: 코어 0.5, 학교 선택 0.25, AP CS 1.0. 가중 = Honors/AP (+)
- 과목코드 1사회 2영어 3수학 4과학 5외국어 6예술 7경영 8체육 9학교선택. 자체 선택과목은 코드 없음(제목으로 식별)
- 성적 한 컬렉션, 출처: past / transfer / apex / cw / miri / elective
- 출결: 예외만 기록(u.t/u.a/e.t/e.a). 슬립 번호+승인 → u→e 변환, 원본 유지
- 징계: 규정 제14조 Action 1~6. 성적표 기록 1 안 함, 2·3 SAC 결정, 4~6 기록
- 학생 권한: 자기 정보 읽기 전용 + "확인" + 수정 요청. 수상·활동은 자기 입력, 행정 승인
- 가져온 데이터는 needsReview=true → 당사자 확인
- 비밀번호 저장 안 함. 로그인 ID는 accounts(행정 전용). 징계는 교직원만
- 플랫폼: 제품은 Educclesia, 학교 데이터는 schools/{sid}

## 작업 방식
- 집 맥북 ~/qum-sis에서 git push(클로드 세션에는 joonkim-lab GitHub 푸시 권한 없음 → 커밋까지 클로드, push는 준킴쌤)
- firestore.rules 바뀌면 콘솔에 게시 필요(클로드가 맥 클립보드 + 크롬으로 붙여넣기 가능)
- 명령 블록은 기기 라벨 `: 【맥북】` / `: 【맥미니】` 첫 줄

## 다음 할 일 (준킴쌤 지시 순서)
1. **졸업 이수 현황**(Genius Transcript Analysis처럼): 학교 설정에 영역별 필요 학점 → 학생 화면에 이수/수강중/계획/부족. 학생 본인도 열람. 미리는 과목별 단원 기준
2. **변경 이력(Student Log)**: 성적·출결·징계·승인 쓰기마다 누가·언제·무엇을 자동 기록. **교장만 열람**
3. Progress Report = 한글 성적표(미리 중심): 배운 내용 + 교사 코멘트 학기 1회, **수업(반) 단위 일괄 입력**(학생마다 클릭해 들어가는 방식 X)
4. Genius 갱신 버튼(행정이 직접 2주마다)
5. 이전 목록: 안지연 2022-23 봄 성적 오류 확인, 학교 로고 업로드, 학부모 문자, 발행 자동화(맥미니 Playwright)
