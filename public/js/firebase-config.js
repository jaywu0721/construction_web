// Firebase 配置文件
const firebaseConfig = {
  apiKey: "AIzaSyD9X9E2R3fExDTzD6pMNu7LbdUAjGWzeJM",
  authDomain: "pmis-system.firebaseapp.com",
  projectId: "pmis-system",
  storageBucket: "pmis-system.firebasestorage.app",
  messagingSenderId: "134705110633",
  appId: "1:134705110633:web:fafe510cf2c0a86fd14cf8"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

// 獲取資料庫實例
const db = firebase.firestore();

// 增加快取大小，提升離線性能
firebase.firestore().settings({
  cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
});

// 全局連接狀態追蹤
let isConnected = false;
let pendingSyncRequests = [];
let syncInProgress = false;
let lastSyncTime = 0;

// 啟用離線持久化
db.enablePersistence({ synchronizeTabs: true })
  .then(() => {
    console.log('離線持久化已啟用');
  })
  .catch((err) => {
    if (err.code == 'failed-precondition') {
      console.warn('多標籤環境下無法啟用離線持久化，將使用本地儲存作為備份');
    } else if (err.code == 'unimplemented') {
      console.warn('當前瀏覽器不支持離線持久化，將使用本地儲存作為備份');
    }
  });

// 改進連接狀態監控
db.collection("connectionStatus").doc("status").onSnapshot(() => {
  if (!isConnected) {
    isConnected = true;
    console.log('Firebase 連接已恢復');
    
    // 連接恢復時處理所有待處理的同步請求
    if (pendingSyncRequests.length > 0) {
      processPendingSyncRequests();
    }
    
    // 連接恢復時，嘗試提交所有緩衝區的寫入操作
    if (window.bufferedWriter) {
      window.bufferedWriter.flush().then(() => {
        console.log('緩衝區寫入已在連接恢復後提交');
      }).catch(error => {
        console.error('連接恢復後提交緩衝區寫入失敗:', error);
      });
    }
  }
}, (error) => {
  isConnected = false;
  console.log('Firebase 連接已斷開:', error);
});

// 處理待處理的同步請求
async function processPendingSyncRequests() {
  if (syncInProgress || pendingSyncRequests.length === 0) {
    return;
  }
  
  syncInProgress = true;
  
  try {
    console.log(`處理 ${pendingSyncRequests.length} 個待處理的同步請求`);
    
    // 複製待處理請求並清空原列表
    const requests = [...pendingSyncRequests];
    pendingSyncRequests = [];
    
    // 按類型分組請求
    const grouped = {};
    requests.forEach(req => {
      const key = `${req.projectName}_${req.dataKey}`;
      grouped[key] = req;
    });
    
    // 處理每個分組
    for (const key in grouped) {
      const req = grouped[key];
      await saveProjectDataToFirebaseDirectly(req.projectName, req.dataKey, req.data);
    }
    
    lastSyncTime = Date.now();
    console.log('所有待處理的同步請求已處理完成');
  } catch (error) {
    console.error('處理待處理同步請求失敗:', error);
  } finally {
    syncInProgress = false;
    
    // 檢查處理期間是否有新的請求加入
    if (pendingSyncRequests.length > 0) {
      setTimeout(processPendingSyncRequests, 1000);
    }
  }
}

// 批量寫入輔助函數
async function batchWrite(operations) {
  if (operations.length === 0) return true;
  
  try {
    // Firebase 批次操作限制為每批最多 500 個操作
    const batchSize = 500;
    let batch = db.batch();
    let operationCount = 0;
    let totalOperations = 0;
    
    for (const op of operations) {
      const { ref, data, type = 'set' } = op;
      
      if (type === 'update') {
        batch.update(ref, data);
      } else {
        batch.set(ref, data);
      }
      
      operationCount++;
      totalOperations++;
      
      // 達到批次大小限制時，提交當前批次並創建新批次
      if (operationCount === batchSize) {
        await batch.commit();
        console.log(`已提交批次操作 ${totalOperations}/${operations.length}`);
        batch = db.batch();
        operationCount = 0;
      }
    }
    
    // 提交剩餘的操作
    if (operationCount > 0) {
      await batch.commit();
      console.log(`批量操作完成，共處理 ${operations.length} 個操作`);
    }
    
    return true;
  } catch (error) {
    console.error('批量寫入失敗:', error);
    throw error; // 向上拋出錯誤，讓調用者知道寫入失敗
  }
}

// 緩衝區寫入類 - 合併短時間內的多次寫入操作
class BufferedWriter {
  constructor(timeout = 500) {
    this.buffer = {};
    this.timeout = timeout;
    this.timer = null;
    this.pendingPromise = null;
    this.resolvers = [];
  }

  add(docPath, data, type = 'update') {
    // 使用文檔路徑作為鍵，確保相同文檔的多次更新會被合併
    this.buffer[docPath] = {
      ref: typeof docPath === 'string' ? db.doc(docPath) : docPath,
      data: data,
      type: type
    };
    
    // 創建一個 Promise，讓呼叫者可以等待操作完成
    const promise = new Promise((resolve, reject) => {
      this.resolvers.push({ resolve, reject });
    });
    
    // 設置定時器，延遲執行批量寫入
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.timeout);
    }
    
    return promise;
  }

  async flush() {
    if (Object.keys(this.buffer).length === 0) {
      this.resolveAll(true);
      return true;
    }
    
    // 準備批量寫入操作
    const operations = Object.values(this.buffer);
    this.buffer = {};
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    // 執行批量寫入
    try {
      // 如果沒有網絡連接，添加到待處理列表
      if (!isConnected) {
        console.log('離線狀態下，將操作添加到待處理列表');
        operations.forEach(op => {
          // 從引用中提取項目信息
          const pathParts = op.ref.path.split('/');
          if (pathParts[0] === 'projects' && pathParts.length >= 4) {
            const projectName = pathParts[1];
            const dataKey = pathParts[2];
            
            // 添加到待處理列表
            pendingSyncRequests.push({
              projectName,
              dataKey,
              data: op.data.items,
              timestamp: Date.now()
            });
          }
        });
        
        // 在本地存儲中標記有待處理的同步
        localStorage.setItem('has_pending_sync', 'true');
        
        this.resolveAll(true);
        return true;
      }
      
      const result = await batchWrite(operations);
      console.log(`緩衝區寫入完成，共處理 ${operations.length} 個操作`);
      
      // 完成所有等待此批次的 Promise
      this.resolveAll(result);
      return result;
    } catch (error) {
      console.error('緩衝區寫入失敗:', error);
      this.rejectAll(error);
      return false;
    }
  }
  
  resolveAll(result) {
    this.resolvers.forEach(resolver => resolver.resolve(result));
    this.resolvers = [];
  }
  
  rejectAll(error) {
    this.resolvers.forEach(resolver => resolver.reject(error));
    this.resolvers = [];
  }
}

// 初始化緩衝區寫入器 - 減少緩衝時間以提高數據一致性
const bufferedWriter = new BufferedWriter(300); // 300ms 緩衝時間

// 從 localStorage 遷移資料到 Firebase
async function migrateDataToFirebase() {
  // 檢查是否已遷移
  const hasMigrated = localStorage.getItem('firebase_migration_completed');
  if (hasMigrated === 'true') {
    console.log('資料已遷移，無需再次遷移');
    return;
  }

  // 取得所有建案
  const projects = JSON.parse(localStorage.getItem("projects")) || [];
  const currentProject = localStorage.getItem("currentProject") || "";
  
  if (projects.length > 0) {
    try {
      // 儲存建案列表
      await db.collection("projectList").doc("projects").set({
        projects: projects,
        currentProject: currentProject
      });
      
      // 遷移每個建案的資料 - 使用批量寫入提高效率
      const operations = [];
      
      for (const project of projects) {
        // 獲取所有與此建案相關的 localStorage 鍵
        const allKeys = Object.keys(localStorage);
        const projectKeys = allKeys.filter(key => key.startsWith(`${project}_`));
        
        for (const key of projectKeys) {
          const data = JSON.parse(localStorage.getItem(key));
          const dataType = key.split('_')[1]; // 例如 "defects", "logs" 等
          
          // 確保數據是數組
          const safeData = Array.isArray(data) ? data : 
                          (typeof data === 'object' ? Object.values(data).filter(Boolean) : []);
          
          // 準備批量寫入操作
          operations.push({
            ref: db.collection("projects").doc(project).collection(dataType).doc("data"),
            data: {
              items: safeData,
              lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            },
            type: 'set'
          });
        }
      }
      
      // 執行批量寫入
      if (operations.length > 0) {
        await batchWrite(operations);
      }
      
      // 標記遷移完成
      localStorage.setItem('firebase_migration_completed', 'true');
      console.log('資料遷移完成');
    } catch (error) {
      console.error('資料遷移錯誤:', error);
    }
  }
}

// Firebase 資料讀取與儲存函數
async function getProjectsFromFirebase() {
  try {
    // 先從本地讀取，確保界面快速響應
    const localProjects = JSON.parse(localStorage.getItem("projects")) || [];
    
    // 然後嘗試從 Firebase 獲取最新數據
    const doc = await db.collection("projectList").doc("projects").get();
    
    if (doc.exists) {
      const data = doc.data();
      const firebaseProjects = data.projects || [];
      
      // 如果 Firebase 有數據，更新本地存儲
      if (firebaseProjects.length > 0) {
        localStorage.setItem("projects", JSON.stringify(firebaseProjects));
        return firebaseProjects;
      }
    }
    
    // 如果 Firebase 沒有數據但本地有，嘗試同步到 Firebase
    if (localProjects.length > 0 && isConnected) {
      const currentProject = localStorage.getItem("currentProject") || "";
      bufferedWriter.add('projectList/projects', {
        projects: localProjects,
        currentProject: currentProject,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, 'set');
    }
    
    return localProjects;
  } catch (error) {
    console.error('讀取建案失敗:', error);
    // 作為備份，從localStorage讀取
    return JSON.parse(localStorage.getItem("projects")) || [];
  }
}

async function getCurrentProjectFromFirebase() {
  try {
    // 先從本地讀取，確保界面快速響應
    const localCurrentProject = localStorage.getItem("currentProject") || "";
    
    // 然後嘗試從 Firebase 獲取最新數據
    const doc = await db.collection("projectList").doc("projects").get();
    
    if (doc.exists) {
      const data = doc.data();
      const firebaseCurrentProject = data.currentProject || "";
      
      // 如果 Firebase 有數據，更新本地存儲
      if (firebaseCurrentProject) {
        localStorage.setItem("currentProject", firebaseCurrentProject);
        return firebaseCurrentProject;
      }
    }
    
    // 如果 Firebase 沒有數據但本地有，嘗試同步到 Firebase
    if (localCurrentProject && isConnected) {
      const projects = JSON.parse(localStorage.getItem("projects")) || [];
      bufferedWriter.add('projectList/projects', {
        projects: projects,
        currentProject: localCurrentProject,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, 'set');
    }
    
    return localCurrentProject;
  } catch (error) {
    console.error('讀取當前建案失敗:', error);
    // 作為備份，從localStorage讀取
    return localStorage.getItem("currentProject") || "";
  }
}

async function saveProjectsToFirebase(projects, currentProject) {
  // 資料驗證 - 簡化驗證邏輯
  if (!Array.isArray(projects)) {
    console.warn('項目不是數組，轉換為空數組');
    projects = [];
  }
  
  try {
    // 立即更新 localStorage 以保持 UI 響應
    localStorage.setItem("projects", JSON.stringify(projects));
    localStorage.setItem("currentProject", currentProject);
    
    // 使用緩衝區寫入而非直接寫入
    await bufferedWriter.add('projectList/projects', {
      projects: projects,
      currentProject: currentProject,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, 'set');
    
    return true;
  } catch (error) {
    console.error('儲存建案失敗:', error);
    return false;
  }
}

async function getProjectDataFromFirebase(projectName, dataKey) {
  console.log(`嘗試讀取數據: 專案=${projectName}, 鍵=${dataKey}`);
  
  // 如果沒有專案名稱，直接返回空數組
  if (!projectName) {
    console.warn('專案名稱為空，無法讀取數據');
    return [];
  }
  
  try {
    // 先從本地存儲讀取，確保界面快速響應
    const key = `${projectName}_${dataKey}`;
    let localData = [];
    
    try {
      const localDataString = localStorage.getItem(key);
      if (localDataString) {
        localData = JSON.parse(localDataString);
      }
    } catch (e) {
      console.error('解析本地數據錯誤:', e);
    }
    
    // 確保 localData 是陣列
    if (!Array.isArray(localData)) {
      localData = typeof localData === 'object' && localData !== null ? 
                 Object.values(localData).filter(Boolean) : [];
    }
    
    console.log(`本地數據讀取結果: ${key}, 長度=${localData.length}`);
    
    // 在異步讀取 Firebase 的同時，先返回本地數據以提高用戶體驗
    if (!isConnected) {
      console.log('離線狀態，僅使用本地數據');
      // 將讀取請求添加到待處理列表，連線後更新數據
      pendingSyncRequests.push({
        projectName,
        dataKey,
        type: 'read',
        timestamp: Date.now()
      });
      return localData;
    }
    
    // 嘗試從 Firebase 讀取最新數據
    const doc = await db.collection("projects").doc(projectName).collection(dataKey).doc("data").get();
    
    if (doc.exists) {
      const data = doc.data();
      if (data && data.items) {
        // 確保返回值是數組
        const firebaseData = Array.isArray(data.items) ? data.items : 
                          (typeof data.items === 'object' ? Object.values(data.items).filter(Boolean) : []);
        
        console.log(`Firebase數據讀取成功: ${key}, 長度=${firebaseData.length}`);
        
        // 如果 Firebase 數據與本地數據不同，更新本地存儲
        const localDataStr = JSON.stringify(localData);
        const firebaseDataStr = JSON.stringify(firebaseData);
        
        if (localDataStr !== firebaseDataStr) {
          localStorage.setItem(key, firebaseDataStr);
          console.log(`已更新本地存儲: ${key}`);
        }
        
        return firebaseData;
      }
    }
    
    // 如果 Firebase 沒有數據但本地有，嘗試同步到 Firebase
    if (localData.length > 0 && isConnected) {
      console.log(`本地數據存在但Firebase無數據，同步到Firebase: ${key}`);
      saveProjectDataToFirebaseDirectly(projectName, dataKey, localData);
    }
    
    return localData;
  } catch (error) {
    console.error(`讀取建案資料失敗(${projectName}, ${dataKey}):`, error);
    
    // 作為備份，從localStorage讀取
    const key = `${projectName}_${dataKey}`;
    const localData = localStorage.getItem(key);
    if (!localData) return [];
    
    try {
      const parsedData = JSON.parse(localData);
      return Array.isArray(parsedData) ? parsedData : 
             (typeof parsedData === 'object' ? Object.values(parsedData).filter(Boolean) : []);
    } catch (e) {
      console.error('解析本地數據錯誤:', e);
      return [];
    }
  }
}

// 直接保存到 Firebase 的函數，不使用緩衝區
async function saveProjectDataToFirebaseDirectly(projectName, dataKey, data) {
  console.log(`直接保存數據到Firebase: 專案=${projectName}, 鍵=${dataKey}`);
  
  // 簡化資料驗證
  const safeData = Array.isArray(data) ? data.filter(Boolean) : 
                  (typeof data === 'object' && data !== null ? 
                   Object.values(data).filter(Boolean) : []);
  
  try {
    // 路徑參考
    const projectRef = db.collection("projects").doc(projectName);
    const dataRef = projectRef.collection(dataKey).doc("data");
    
    // 檢查專案文檔是否存在
    const projectDoc = await projectRef.get();
    if (!projectDoc.exists) {
      // 如果項目文檔不存在，則創建
      await projectRef.set({
        name: projectName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log(`已創建專案文檔: ${projectName}`);
      
      // 數據文檔一定不存在，使用 set
      await dataRef.set({
        items: safeData,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // 檢查數據文檔是否存在
      const dataDoc = await dataRef.get();
      
      if (dataDoc.exists) {
        // 文檔存在，使用 update 而非 set，減少寫入量
        await dataRef.update({
          items: safeData,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // 數據文檔不存在，使用 set
        await dataRef.set({
          items: safeData,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    }
    
    console.log(`數據已直接保存到Firebase: 專案=${projectName}, 鍵=${dataKey}`);
    return true;
  } catch (error) {
    console.error(`直接保存到Firebase失敗(${projectName}, ${dataKey}):`, error);
    throw error;
  }
}

async function saveProjectDataToFirebase(projectName, dataKey, data) {
  console.log(`嘗試保存數據: 專案=${projectName}, 鍵=${dataKey}`);
  
  // 如果沒有專案名稱，直接返回失敗
  if (!projectName) {
    console.warn('專案名稱為空，無法保存數據');
    return false;
  }
  
  // 簡化資料驗證
  const safeData = Array.isArray(data) ? data.filter(Boolean) : 
                  (typeof data === 'object' && data !== null ? 
                   Object.values(data).filter(Boolean) : []);
  
  try {
    // 立即更新 localStorage 以提供快速回饋
    const key = `${projectName}_${dataKey}`;
    localStorage.setItem(key, JSON.stringify(safeData));
    console.log(`已立即更新本地存儲: ${key}`);
    
    // 如果離線，添加到待處理同步列表
    if (!isConnected) {
      console.log('離線狀態，添加到待處理同步列表');
      pendingSyncRequests.push({
        projectName,
        dataKey,
        data: safeData,
        timestamp: Date.now()
      });
      
      localStorage.setItem('has_pending_sync', 'true');
      return true;
    }
    
    // 路徑參考
    const projectRef = db.collection("projects").doc(projectName);
    const dataRef = projectRef.collection(dataKey).doc("data");
    
    // 檢查專案文檔是否存在
    const projectDoc = await projectRef.get();
    if (!projectDoc.exists) {
      // 如果項目文檔不存在，則創建
      await projectRef.set({
        name: projectName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log(`已創建專案文檔: ${projectName}`);
      
      // 數據文檔一定不存在，使用 set
      bufferedWriter.add(dataRef, {
        items: safeData,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, 'set');
    } else {
      // 檢查數據文檔是否存在
      const dataDoc = await dataRef.get();
      
      if (dataDoc.exists) {
        // 文檔存在，使用 update 而非 set，減少寫入量
        bufferedWriter.add(dataRef, {
          items: safeData,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, 'update');
      } else {
        // 數據文檔不存在，使用 set
        bufferedWriter.add(dataRef, {
          items: safeData,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, 'set');
      }
    }
    
    console.log(`數據已成功排入緩衝區: 專案=${projectName}, 鍵=${dataKey}`);
    return true;
  } catch (error) {
    console.error(`儲存建案資料失敗(${projectName}, ${dataKey}):`, error);
    
    // 嘗試僅保存到本地存儲作為備份
    try {
      const key = `${projectName}_${dataKey}`;
      localStorage.setItem(key, JSON.stringify(safeData));
      console.log(`僅保存到本地存儲: ${key}`);
    } catch (localError) {
      console.error('本地存儲也失敗:', localError);
    }
    
    return false;
  }
}

// 檢查網絡連接並嘗試重新連接
async function checkAndReconnect() {
  try {
    await db.enableNetwork();
    console.log('網絡已重新啟用');
    
    // 更新連接狀態
    isConnected = true;
    
    // 重新連接後，嘗試提交所有緩衝區的寫入操作
    if (bufferedWriter) {
      await bufferedWriter.flush();
    }
    
    // 處理所有待處理的同步請求
    if (pendingSyncRequests.length > 0 || localStorage.getItem('has_pending_sync') === 'true') {
      await processPendingSyncRequests();
    }
    
    return true;
  } catch (error) {
    console.error('重新連接失敗:', error);
    isConnected = false;
    return false;
  }
}

// 強制離線模式
async function goOffline() {
  try {
    // 在進入離線模式前，先嘗試提交所有緩衝區的寫入操作
    if (bufferedWriter) {
      await bufferedWriter.flush();
    }
    
    await db.disableNetwork();
    isConnected = false;
    console.log('網絡已禁用，進入離線模式');
    return true;
  } catch (error) {
    console.error('離線模式設置失敗:', error);
    return false;
  }
}

// 立即提交所有緩衝區寫入操作的輔助函數
async function flushBufferedWrites() {
  try {
    if (!isConnected) {
      console.log('當前處於離線狀態，嘗試重新連接');
      await checkAndReconnect();
    }
    
    if (bufferedWriter) {
      const result = await bufferedWriter.flush();
      console.log('已強制提交所有緩衝區寫入');
      return result;
    }
    return true;
  } catch (error) {
    console.error('提交緩衝區寫入失敗:', error);
    return false;
  }
}

// 新增：測試 Firebase 讀寫功能
async function testFirebaseConnection(testData = { test: "連接測試" }) {
  try {
    // 檢查連接狀態
    if (!isConnected) {
      await checkAndReconnect();
    }
    
    // 先嘗試直接寫入測試
    const startTime = performance.now();
    
    // 測試緩衝區寫入性能
    bufferedWriter.add('_test/connection', {
      ...testData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      testType: 'buffered'
    }, 'set');
    
    // 強制立即執行緩衝區操作
    await bufferedWriter.flush();
    
    // 測試直接寫入性能
    await db.collection("_test").doc("direct").set({
      ...testData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      testType: 'direct'
    });
    
    // 計算寫入時間
    const writeTime = performance.now() - startTime;
    
    // 嘗試讀取測試數據
    const startReadTime = performance.now();
    const doc = await db.collection("_test").doc("connection").get();
    const readTime = performance.now() - startReadTime;
    
    // 檢查待處理的同步請求
    const hasPendingSync = pendingSyncRequests.length > 0;
    
    return {
      success: true,
      connected: isConnected,
      exists: doc.exists,
      data: doc.data(),
      performance: {
        writeTime: writeTime.toFixed(2) + 'ms',
        readTime: readTime.toFixed(2) + 'ms'
      },
      pendingSyncs: pendingSyncRequests.length,
      lastSyncTime: lastSyncTime ? new Date(lastSyncTime).toISOString() : null
    };
  } catch (error) {
    console.error("Firebase 連接測試失敗:", error);
    return {
      success: false,
      error: error.message,
      connected: isConnected
    };
  }
}

// 檢查並同步待處理的寫入操作
async function checkPendingSyncs() {
  if (pendingSyncRequests.length > 0 && isConnected) {
    await processPendingSyncRequests();
    return true;
  } else if (localStorage.getItem('has_pending_sync') === 'true' && isConnected) {
    // 嘗試恢復可能在頁面重新載入期間丟失的同步請求
    console.log('檢測到有未完成的同步請求，嘗試恢復');
    
    // 這裡可以添加特定項目的同步邏輯，如果您有確切的項目列表
    const currentProject = localStorage.getItem("currentProject") || "";
    if (currentProject) {
      // 同步所有常用數據
      const commonDataTypes = ['workers', 'workerTypes', 'defects', 'logs', 'photos', 'itemCompanyData'];
      for (const dataType of commonDataTypes) {
        const key = `${currentProject}_${dataType}`;
        const localData = localStorage.getItem(key);
        if (localData) {
          try {
            const data = JSON.parse(localData);
            await saveProjectDataToFirebaseDirectly(currentProject, dataType, data);
          } catch (e) {
            console.error(`恢復同步 ${key} 失敗:`, e);
          }
        }
      }
    }
    
    localStorage.removeItem('has_pending_sync');
    return true;
  }
  return false;
}

// 初始化時執行遷移和檢查未完成的同步
window.addEventListener('DOMContentLoaded', async () => {
  await migrateDataToFirebase();
  
  // 檢查是否有未完成的同步
  setTimeout(async () => {
    await checkPendingSyncs();
  }, 2000); // 等待2秒確保Firebase連接已建立
});

// 離開頁面前嘗試同步
window.addEventListener('beforeunload', async (e) => {
  if (bufferedWriter && Object.keys(bufferedWriter.buffer).length > 0) {
    e.preventDefault();
    e.returnValue = '';
    
    try {
      await bufferedWriter.flush();
    } catch (error) {
      console.error('頁面離開前同步失敗:', error);
    }
  }
});

// 暴露到全局作用域
window.getProjectsFromFirebase = getProjectsFromFirebase;
window.getCurrentProjectFromFirebase = getCurrentProjectFromFirebase;
window.saveProjectsToFirebase = saveProjectsToFirebase;
window.getProjectDataFromFirebase = getProjectDataFromFirebase;
window.saveProjectDataToFirebase = saveProjectDataToFirebase;
window.checkFirebaseConnection = checkAndReconnect;
window.setFirebaseOffline = goOffline;
window.testFirebaseConnection = testFirebaseConnection;
window.bufferedWriter = bufferedWriter;
window.flushBufferedWrites = flushBufferedWrites;
window.isFirebaseConnected = () => isConnected;
window.checkPendingSyncs = checkPendingSyncs;