function go(page){
  location.href = page;
}

// 獲取當前選擇的建案 (支援 Firebase)
async function getCurrentProject() {
  // 優先從 Firebase 讀取
  if (typeof getCurrentProjectFromFirebase === 'function') {
    try {
      return await getCurrentProjectFromFirebase();
    } catch (error) {
      console.error('從Firebase獲取當前建案失敗:', error);
      // 如果失敗，從localStorage讀取
      return localStorage.getItem("currentProject") || "";
    }
  } else {
    // 如果Firebase功能不可用，則從localStorage讀取
    return localStorage.getItem("currentProject") || "";
  }
}

// 獲取特定建案的數據 (支援 Firebase)
async function getProjectData(dataKey) {
  const currentProject = await getCurrentProject();
  if (!currentProject) return [];
  
  // 優先從 Firebase 讀取
  if (typeof getProjectDataFromFirebase === 'function') {
    try {
      return await getProjectDataFromFirebase(currentProject, dataKey);
    } catch (error) {
      console.error(`從Firebase獲取建案資料失敗(${dataKey}):`, error);
      // 如果失敗，從localStorage讀取
      const key = `${currentProject}_${dataKey}`;
      return JSON.parse(localStorage.getItem(key)) || [];
    }
  } else {
    // 如果Firebase功能不可用，則從localStorage讀取
    const key = `${currentProject}_${dataKey}`;
    return JSON.parse(localStorage.getItem(key)) || [];
  }
}

// 保存特定建案的數據 (支援 Firebase)
async function saveProjectData(dataKey, data) {
  const currentProject = await getCurrentProject();
  if (!currentProject) return;
  
  // 優先儲存到 Firebase
  if (typeof saveProjectDataToFirebase === 'function') {
    try {
      await saveProjectDataToFirebase(currentProject, dataKey, data);
    } catch (error) {
      console.error(`儲存建案資料到Firebase失敗(${dataKey}):`, error);
      // 如果失敗，儲存到localStorage
      const key = `${currentProject}_${dataKey}`;
      localStorage.setItem(key, JSON.stringify(data));
    }
  } else {
    // 如果Firebase功能不可用，則儲存到localStorage
    const key = `${currentProject}_${dataKey}`;
    localStorage.setItem(key, JSON.stringify(data));
  }
}