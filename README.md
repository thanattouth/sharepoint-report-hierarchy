# SharePoint Sensitivity Label Report

ระบบรายงานไฟล์ที่ติด Microsoft Purview Sensitivity Label ภายใต้ SharePoint
hierarchy scope ของผู้ใช้ ปัจจุบัน P0–P3 ทำงานด้วย deterministic cached fixtures
P4 เชื่อม Graph แบบ bounded ที่ DGCS แล้ว และ P5/P6 แยก scheduled scanner กับ
cache-only Report API เป็นคนละ Azure Functions/managed identities

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

P5 Timer/Queue deployment, cross-tenant federation, bounded Run now proof และ recovery
อยู่ใน `docs/p5-scheduled-scanner-runbook.md` Timer ถูก deploy แบบ disabled จนกว่า
source-tenant admin consent และ manual proof จะผ่าน
