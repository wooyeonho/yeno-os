# B02-4 — 첫 한끼안부 소개 영상

기존 B02-4 ShoppingShorts 제작 엔진으로 A03 한끼안부의 원본 소개 장면 4개를 20초 무음 세로 MP4로 렌더했다. 현재 Codex가 실행했으며 코어의 자율 제작이나 SNS 게시가 아니다.

- 장면: `hankki-preview.json`. 외부 영상·음악·목소리·사진 재사용 없음.
- 제작기: `scripts/render-video-draft.py`. 브랜드 표시를 BLACKHOLE로 변경했다.
- 확인: H.264 / 720×1280 / 24fps / 20초 / 100,072 bytes. FFprobe 형식 검사와 FFmpeg 전체 디코딩 통과. 첫 장면 이미지에서 한글과 레이아웃 확인.
- 영상 SHA-256: `e26d1094b9c6671f3cf3f61a2113bfa7efde2729a28699a5822ffe6f4e434fc2`.
- Nanum Gothic 사용. [공식 배포 라이선스](https://github.com/google/fonts/blob/main/ofl/nanumgothic/OFL.txt)는 SIL OFL1.1이며 폰트로 만든 문서에 동일 라이선스를 강제하지 않는다. 폰트 파일을 이 저장소에 포함하지 않았다. 사용 폰트 파일 해시는 렌더 영수증에 기록한다.
- 마지막 장면에 단일 브라우저 기록만 가능하고 가족 공유·알림·AI가 미연결임을 명시했다. 출시·고객·수익을 주장하지 않는다.

재현: Pillow/fonttools, ffmpeg/ffprobe, 한국어를 포함한 신뢰할 수 있는 로컬 폰트가 필요하다. 새 출력 경로만 허용한다.

```sh
python3 scripts/render-video-draft.py projects/shorts/hankki-preview.json OUTPUT_DIRECTORY --font FONT_PATH
```

실제 결과는 이번 대화에 별도 영상 파일로 제공했다. 반복해서 렌더한 사실과 모델 연결·폰↔코어 통합은 별개다.
