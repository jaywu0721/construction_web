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
    // 可以在這裡添加連接恢復後的操作
  }
}, (error) => {
  isConnected = false;
  console.log('Firebase 連接已斷開:', error);
});

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
      
      // 遷移每個建案的資料
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
          
          // 將資料儲存到 Firebase
          await db.collection("projects").doc(project).collection(dataType).doc("data").set({
            items: safeData,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
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
  // 資料驗證
  if (!Array.isArray(projects)) {
    console.warn('項目不是數組，轉換為空數組');
    projects = [];
  }
  
  try {
    await db.collection("projectList").doc("projects").set({
      projects: projects,
      currentProject: currentProject,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // 同時更新localStorage作為備份
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
  console.log(`嘗試保存數據到Firebase: 專案=${projectName}, 鍵=${dataKey}`, data);
  // 資料驗證
  let safeData = [];
  
  if (Array.isArray(data)) {
    safeData = data.filter(item => item !== null && item !== undefined);
  } else if (typeof data === 'object' && data !== null) {
    safeData = Object.values(data).filter(item => item !== null && item !== undefined);
  }
  
  try {
    // 確保數據路徑存在
    const projectRef = db.collection("projects").doc(projectName);
    
    // 檢查專案文檔是否存在，如果不存在則創建
    const projectDoc = await projectRef.get();
    if (!projectDoc.exists) {
      await projectRef.set({
        name: projectName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log(`已創建專案文檔: ${projectName}`);
    }
    
    // 保存實際數據
    await projectRef.collection(dataKey).doc("data").set({
      items: safeData,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`數據已成功保存到Firebase: 專案=${projectName}, 鍵=${dataKey}`);
    
    // 同時更新localStorage作為備份
    const key = `${projectName}_${dataKey}`;
    localStorage.setItem(key, JSON.stringify(safeData));
    
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
    return true;
  } catch (error) {
    console.error('重新連接失敗:', error);
    return false;
  }
}

// 強制離線模式
async function goOffline() {
  try {
    await db.disableNetwork();
    console.log('網絡已禁用，進入離線模式');
    return true;
  } catch (error) {
    console.error('離線模式設置失敗:', error);
    return false;
  }
}

// 新增：測試 Firebase 讀寫功能
async function testFirebaseConnection(testData = { test: "連接測試" }) {
  try {
    // 嘗試寫入測試數據
    await db.collection("_test").doc("connection").set({
      ...testData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // 嘗試讀取測試數據
    const doc = await db.collection("_test").doc("connection").get();
    
    return {
      success: true,
      exists: doc.exists,
      data: doc.data()
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