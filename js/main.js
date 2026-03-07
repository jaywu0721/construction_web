function go(page){
  location.href = page;
}

// 獲取當前選擇的建案
function getCurrentProject() {
  return localStorage.getItem("currentProject") || "";
}

// 獲取特定建案的數據
function getProjectData(dataKey) {
  const currentProject = getCurrentProject();
  if (!currentProject) return [];
  
  const key = `${currentProject}_${dataKey}`;
  return JSON.parse(localStorage.getItem(key)) || [];
}

// 保存特定建案的數據
function saveProjectData(dataKey, data) {
  const currentProject = getCurrentProject();
  if (!currentProject) return;
  
  const key = `${currentProject}_${dataKey}`;
  localStorage.setItem(key, JSON.stringify(data));
}