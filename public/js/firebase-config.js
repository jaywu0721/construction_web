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

// 啟用離線持久化
db.enablePersistence({ synchronizeTabs: true })
  .then(() => {
    console.log('離線持久化已啟用');
  })
  .catch((err) => {
    if (err.code == 'failed-precondition') {
      console.warn('多標籤環境下無法啟用離線持久化');
    } else if (err.code == 'unimplemented') {
      console.warn('當前瀏覽器不支持離線持久化');
    }
  });

// 添加連接狀態監控
let isConnected = false;
db.collection("connectionStatus").doc("status").onSnapshot(() => {
  if (!isConnected) {
    isConnected = true;
    console.log('Firebase 連接已恢復');
    // 連接恢復時，嘗試提交所有緩衝區的寫入操作
    if (window.bufferedWriter) {
      window.bufferedWriter.flush();
    }
  }
}, (error) => {
  isConnected = false;
  console.log('Firebase 連接已斷開:', error);
});

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
    return false;
  }
}

// 緩衝區寫入類 - 合併短時間內的多次寫入操作
class BufferedWriter {
  constructor(timeout = 500) {
    this.buffer = {};
    this.timeout = timeout;
    this.timer = null;
  }

  add(docPath, data, type = 'update') {
    // 使用文檔路徑作為鍵，確保相同文檔的多次更新會被合併
    this.buffer[docPath] = {
      ref: typeof docPath === 'string' ? db.doc(docPath) : docPath,
      data: data,
      type: type
    };
    
    // 設置定時器，延遲執行批量寫入
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.timeout);
    }
  }

  async flush() {
    if (Object.keys(this.buffer).length === 0) return true;
    
    // 準備批量寫入操作
    const operations = Object.values(this.buffer);
    this.buffer = {};
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    // 執行批量寫入
    try {
      const result = await batchWrite(operations);
      console.log(`緩衝區寫入完成，共處理 ${operations.length} 個操作`);
      return result;
    } catch (error) {
      console.error('緩衝區寫入失敗:', error);
      return false;
    }
  }
}

// 初始化緩衝區寫入器
const bufferedWriter = new BufferedWriter(500); // 500ms 緩衝時間

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
    const doc = await db.collection("projectList").doc("projects").get();
    if (doc.exists) {
      const data = doc.data();
      return data.projects || [];
    }
    return [];
  } catch (error) {
    console.error('讀取建案失敗:', error);
    // 作為備份，從localStorage讀取
    return JSON.parse(localStorage.getItem("projects")) || [];
  }
}

async function getCurrentProjectFromFirebase() {
  try {
    const doc = await db.collection("projectList").doc("projects").get();
    if (doc.exists) {
      const data = doc.data();
      return data.currentProject || "";
    }
    return "";
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
    // 使用緩衝區寫入而非直接寫入
    bufferedWriter.add('projectList/projects', {
      projects: projects,
      currentProject: currentProject,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, 'set');
    
    // 立即更新 localStorage 以保持 UI 響應
    localStorage.setItem("projects", JSON.stringify(projects));
    localStorage.setItem("currentProject", currentProject);
    
    return true;
  } catch (error) {
    console.error('儲存建案失敗:', error);
    return false;
  }
}

async function getProjectDataFromFirebase(projectName, dataKey) {
  console.log(`嘗試從Firebase讀取數據: 專案=${projectName}, 鍵=${dataKey}`);
  try {
    const doc = await db.collection("projects").doc(projectName).collection(dataKey).doc("data").get();
    console.log(`Firebase查詢結果: 文檔存在=${doc.exists}`, doc.exists ? doc.data() : null);
    
    if (doc.exists) {
      const data = doc.data();
      // 確保返回值是數組
      if (!data || !data.items) return [];
      return Array.isArray(data.items) ? data.items : 
             (typeof data.items === 'object' ? Object.values(data.items).filter(Boolean) : []);
    }
    return [];
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

async function saveProjectDataToFirebase(projectName, dataKey, data) {
  console.log(`嘗試保存數據到Firebase: 專案=${projectName}, 鍵=${dataKey}`);
  
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
    
    // 立即更新 localStorage 以提供快速回饋
    const key = `${projectName}_${dataKey}`;
    localStorage.setItem(key, JSON.stringify(safeData));
    
    console.log(`數據已成功排入緩衝區: 專案=${projectName}, 鍵=${dataKey}`);
    return true;
  } catch (error) {
    console.error(`儲存建案資料失敗(${projectName}, ${dataKey}):`, error);
    
    // 嘗試僅保存到本地存儲作為備份
    try {
      const key = `${projectName}_${dataKey}`;
      localStorage.setItem(key, JSON.stringify(safeData));
      console.log(`已儲存到本地存儲: ${key}`);
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
    // 重新連接後，嘗試提交所有緩衝區的寫入操作
    if (bufferedWriter) {
      await bufferedWriter.flush();
    }
    return true;
  } catch (error) {
    console.error('重新連接失敗:', error);
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
    console.log('網絡已禁用，進入離線模式');
    return true;
  } catch (error) {
    console.error('離線模式設置失敗:', error);
    return false;
  }
}

// 立即提交所有緩衝區寫入操作的輔助函數
async function flushBufferedWrites() {
  if (bufferedWriter) {
    return await bufferedWriter.flush();
  }
  return true;
}

// 新增：測試 Firebase 讀寫功能
async function testFirebaseConnection(testData = { test: "連接測試" }) {
  try {
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
    
    return {
      success: true,
      exists: doc.exists,
      data: doc.data(),
      performance: {
        writeTime: writeTime.toFixed(2) + 'ms',
        readTime: readTime.toFixed(2) + 'ms'
      }
    };
  } catch (error) {
    console.error("Firebase 連接測試失敗:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 初始化時執行遷移
window.addEventListener('DOMContentLoaded', () => {
  migrateDataToFirebase();
});

// 重要：確保所有函數都導出為 window 對象的屬性，以便在其他頁面中使用
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