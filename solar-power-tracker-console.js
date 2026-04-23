(async () => {
  const MAX_PAGE = 178; // 改成总页数
  const allData = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalizeKey(text) {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[()]/g, "")
      .replace(/\//g, "_")
      .replace(/-+/g, "_");
  }

  function getHeaders() {
    return Array.from(document.querySelectorAll("#table thead th")).map((th) =>
      th.innerText.trim(),
    );
  }

  function extractCurrentPage() {
    const headers = getHeaders();
    const rows = document.querySelectorAll("#table tbody tr");

    return Array.from(rows)
      .map((tr) => {
        const tds = tr.querySelectorAll("td");
        if (!tds.length) return null;

        const row = {};

        const firstLink = tds[0].querySelector("a");
        row.project = firstLink
          ? firstLink.innerText.trim()
          : tds[0].innerText.trim();
        row.project_url = firstLink ? firstLink.href : null;

        for (let i = 1; i < tds.length; i++) {
          const key = normalizeKey(headers[i] || `col_${i}`);
          row[key] = tds[i].innerText.trim();
        }

        return row;
      })
      .filter(Boolean);
  }

  console.log("开始抓取...");

  for (let i = 0; i < MAX_PAGE; i++) {
    console.log(`抓取第 ${i + 1} / ${MAX_PAGE} 页`);

    const pageData = extractCurrentPage();
    allData.push(...pageData);

    if (i < MAX_PAGE - 1) {
      const nextBtn = document.querySelector('a[data-dt-idx="next"]');
      if (!nextBtn) {
        console.log("未找到 next 按钮，提前结束");
        break;
      }
      nextBtn.click();
      await sleep(50);
    }
  }

  window.__TABLE_DATA__ = allData;

  console.log("抓取完成，总条数:", allData.length);
  console.log(allData);

  const blob = new Blob([JSON.stringify(allData, null, 2)], {
    type: "application/json",
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "solar_data.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  console.log("已导出 solar_data.json");
})();
