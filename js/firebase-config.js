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
          
          // 將資料儲存到 Firebase
          await db.collection("projects").doc(project).collection(dataType).doc("data").set({
            items: data
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
  try {
    await db.collection("projectList").doc("projects").set({
      projects: projects,
      currentProject: currentProject
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
  try {
    const doc = await db.collection("projects").doc(projectName).collection(dataKey).doc("data").get();
    if (doc.exists) {
      const data = doc.data();
      return data.items || [];
    }
    return [];
  } catch (error) {
    console.error(`讀取建案資料失敗(${projectName}, ${dataKey}):`, error);
    // 作為備份，從localStorage讀取
    const key = `${projectName}_${dataKey}`;
    return JSON.parse(localStorage.getItem(key)) || [];
  }
}

async function saveProjectDataToFirebase(projectName, dataKey, data) {
  try {
    await db.collection("projects").doc(projectName).collection(dataKey).doc("data").set({
      items: data
    });
    
    // 同時更新localStorage作為備份
    const key = `${projectName}_${dataKey}`;
    localStorage.setItem(key, JSON.stringify(data));
    
    return true;
  } catch (error) {
    console.error(`儲存建案資料失敗(${projectName}, ${dataKey}):`, error);
    return false;
  }
}

// 初始化時執行遷移
window.addEventListener('DOMContentLoaded', () => {
  migrateDataToFirebase();
});