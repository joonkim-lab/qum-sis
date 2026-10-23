# Qum Academic System (qum-sis)

학교용 학생 정보 시스템. Firestore + GitHub Pages, 단일 `index.html`.
제품은 Educclesia Group, 데이터는 각 학교(`schools/{schoolId}`).

## 구조
```
index.html        앱 전체 (로그인·현황·학생·신입생 등록·가져오기·학교 설정)
firestore.rules   역할별 권한 (owner / principal / admin / teacher / student)
data/students_seed.csv   2026-10 명부 51명 (가져오기 화면에 그대로 올리면 됨)
```

## Firestore
```
memberships/{email}            {schoolId, role, studentId?}
schools/{sid}                  학교 설정 (이름·로고·색·주소·CEEB·학기코드·nextId)
schools/{sid}/students/{id}    학생 (키 = Genius ID, 신입생은 9001부터)
schools/{sid}/accounts/{id}    로그인 ID 등 (행정 전용)
schools/{sid}/courses | grades | attendance | activities | comments | payments | calendar   (다음 단계)
```

## 처음 한 번 (Firebase 콘솔)
1. Firestore → 규칙 탭 → `firestore.rules` 내용 붙여넣고 게시
2. Authentication → 설정 → 승인된 도메인에 `joonkim-lab.github.io` 추가
3. `joon.kim@educclesia.com`으로 앱에 로그인하면 학교 `qum`과 소유자 멤버십이 자동 생성됨

## 배포
GitHub Pages (`main` 브랜치, 루트). URL: https://joonkim-lab.github.io/qum-sis/

## 단계
1. 학생 명부 → 과목·성적 → Transcript PDF   ← 지금 여기 (명부까지 완료)
2. 출결 입력 + 과거 합계 이관 + 슬립 승인
3. 학생 로그인 + 수상·활동 자기 입력 + 행정 승인
4. 학습성장기록부 · Progress Report, 체크 발행
5. 학교 설정·로고 교체 · 신규 학교 생성(판매)

## 규칙
- 가져온 데이터는 전부 `needsReview: true` → 학생·교사가 자기 화면에서 확인 완료
- 계산값(GPA·학점 합계)은 저장하지 않고 출력 때 계산
- 학기 코드는 `2026F / 2026S / 2026U`로 저장, 출력 때 "Fall 2026-27"로 변환
