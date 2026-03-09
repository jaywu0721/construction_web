// 頁面導航函數
function go(page) {
  location.href = page;
}

// 獲取當前選擇的建案 (支援 Firebase)
async function getCurrentProject() {
  // 優先從本地變數快取讀取，加快多次呼叫的速度
  if (window._cachedCurrentProject !== undefined) {
    return window._cachedCurrentProject;
  }
  
  // 優先從 Firebase 讀取
  if (typeof getCurrentProjectFromFirebase === 'function') {
    try {
      const project = await getCurrentProjectFromFirebase();
      // 儲存到快取中
      window._cachedCurrentProject = project;
      return project;
    } catch (error) {
      console.error('從Firebase獲取當前建案失敗:', error);
      // 如果失敗，從localStorage讀取
      const localProject = localStorage.getItem("currentProject") || "";
      window._cachedCurrentProject = localProject;
      return localProject;
    }
  } else {
    // 如果Firebase功能不可用，則從localStorage讀取
    const localProject = localStorage.getItem("currentProject") || "";
    window._cachedCurrentProject = localProject;
    return localProject;
  }
}

// 清除專案快取，當專案切換時呼叫
function clearProjectCache() {
  window._cachedCurrentProject = undefined;
  window._cachedProjectData = {}; // 清除所有數據快取
}

// 獲取特定建案的數據 (支援 Firebase 與本地快取)
async function getProjectData(dataKey) {
  const currentProject = await getCurrentProject();
  if (!currentProject) return [];
  
  // 初始化快取物件
  if (!window._cachedProjectData) {
    window._cachedProjectData = {};
  }
  
  // 檢查是否有快取數據
  const cacheKey = `${currentProject}_${dataKey}`;
  if (window._cachedProjectData[cacheKey]) {
    return window._cachedProjectData[cacheKey];
  }
  
  // 優先從 Firebase 讀取
  if (typeof getProjectDataFromFirebase === 'function') {
    try {
      const data = await getProjectDataFromFirebase(currentProject, dataKey);
      // 儲存到快取中
      window._cachedProjectData[cacheKey] = data;
      return data;
    } catch (error) {
      console.error(`從Firebase獲取建案資料失敗(${dataKey}):`, error);
      // 如果失敗，從localStorage讀取
      try {
        const key = `${currentProject}_${dataKey}`;
        const localData = JSON.parse(localStorage.getItem(key)) || [];
        window._cachedProjectData[cacheKey] = localData;
        return localData;
      } catch (e) {
        console.error('解析本地數據錯誤:', e);
        return [];
      }
    }
  } else {
    // 如果Firebase功能不可用，則從localStorage讀取
    try {
      const key = `${currentProject}_${dataKey}`;
      const localData = JSON.parse(localStorage.getItem(key)) || [];
      window._cachedProjectData[cacheKey] = localData;
      return localData;
    } catch (e) {
      console.error('解析本地數據錯誤:', e);
      return [];
    }
  }
}

// 保存特定建案的數據 (使用緩衝區寫入策略)
async function saveProjectData(dataKey, data) {
  const currentProject = await getCurrentProject();
  if (!currentProject) return false;
  
  // 更新本地快取，實現立即的UI響應
  if (!window._cachedProjectData) {
    window._cachedProjectData = {};
  }
  const cacheKey = `${currentProject}_${dataKey}`;
  window._cachedProjectData[cacheKey] = data;
  
  // 優先儲存到 Firebase (使用緩衝區寫入)
  if (typeof saveProjectDataToFirebase === 'function') {
    try {
      return await saveProjectDataToFirebase(currentProject, dataKey, data);
    } catch (error) {
      console.error(`儲存建案資料到Firebase失敗(${dataKey}):`, error);
      // 如果失敗，儲存到localStorage
      const key = `${currentProject}_${dataKey}`;
      localStorage.setItem(key, JSON.stringify(data));
      return false;
    }
  } else {
    // 如果Firebase功能不可用，則儲存到localStorage
    const key = `${currentProject}_${dataKey}`;
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  }
}

// 新增：立即同步所有待處理的寫入操作
// 在關鍵操作前使用，確保所有數據已完全保存
async function syncAllPendingWrites() {
  if (typeof flushBufferedWrites === 'function') {
    try {
      await flushBufferedWrites();
      return true;
    } catch (error) {
      console.error('強制同步寫入操作失敗:', error);
      return false;
    }
  }
  return true; // 如果沒有緩衝區寫入功能，直接返回成功
}

// 新增：高頻率更新優化 - 用於需要頻繁更新的場景
// 當UI中有快速連續的更新時使用此函數
function saveProjectDataThrottled(dataKey, data) {
  // 確保在任何情況下都更新本地快取
  if (!window._cachedProjectData) {
    window._cachedProjectData = {};
  }
  
  getCurrentProject().then(currentProject => {
    if (!currentProject) return;
    
    const cacheKey = `${currentProject}_${dataKey}`;
    window._cachedProjectData[cacheKey] = data;
    
    // 儲存到localStorage作為即時備份
    const key = `${currentProject}_${dataKey}`;
    localStorage.setItem(key, JSON.stringify(data));
    
    // 如果有緩衝區寫入功能，使用它來節流寫入操作
    if (typeof window.bufferedWriter !== 'undefined') {
      const docPath = `projects/${currentProject}/${dataKey}/data`;
      window.bufferedWriter.add(docPath, {
        items: data,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, 'update');
    } 
    // 如果沒有緩衝寫入但有Firebase儲存功能，則使用普通儲存
    else if (typeof saveProjectDataToFirebase === 'function') {
      saveProjectDataToFirebase(currentProject, dataKey, data)
        .catch(error => console.error(`節流寫入失敗(${dataKey}):`, error));
    }
  });
}

// 新增：取得Firebase連接狀態
function getConnectionStatus() {
  return isConnected || false; // 從firebase-config.js導出的變數
}

// 測試Firestore連接和寫入性能
async function testDatabasePerformance() {
  if (typeof testFirebaseConnection === 'function') {
    const testResult = await testFirebaseConnection({
      test: "性能測試",
      timestamp: new Date().toISOString()
    });
    console.log('數據庫性能測試結果:', testResult);
    return testResult;
  }
  return { success: false, error: 'Firebase測試功能不可用' };
}

// 將函數導出為全局變數
window.go = go;
window.getCurrentProject = getCurrentProject;
window.getProjectData = getProjectData;
window.saveProjectData = saveProjectData;
window.clearProjectCache = clearProjectCache;
window.syncAllPendingWrites = syncAllPendingWrites;
window.saveProjectDataThrottled = saveProjectDataThrottled;
window.getConnectionStatus = getConnectionStatus;
window.testDatabasePerformance = testDatabasePerformance;