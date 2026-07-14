# SharePoint Sensitivity Label Report

ระบบรายงานไฟล์ที่ติด Microsoft Purview Sensitivity Label ภายใต้ SharePoint
hierarchy scope ของผู้ใช้ ปัจจุบัน P0–P3 ทำงานด้วย deterministic cached fixtures
และเริ่ม P4 ด้วย production Graph adapter ที่ยังไม่รับ tenant credential จนผ่าน
security/allowlist/storage approval gate

## Local development

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
```

หน้า Report ใช้ cached store contracts เท่านั้นและไม่เรียก Microsoft Graph ตอนโหลดหน้า
P4 scanner boundary, environment contract และขั้นตอน approval อยู่ใน
`docs/p4-graph-pilot.md` ห้าม commit populated `.env` หรือ scanner credential
