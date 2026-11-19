const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("toni", {
  getState: () => ipcRenderer.invoke("state:get"),
  setSettings: settings => ipcRenderer.send("set", settings),
  remindNow: () => ipcRenderer.send("remind:now"),
  onState: callback => subscribe("state", callback),
  onVisibility: callback => subscribe("visibility", callback),
  onReminder: callback => subscribe("card:show", callback),
  resizeCard: height => ipcRenderer.send("card:resize", height),
  completeExercise: id => ipcRenderer.invoke("card:done", id),
  snooze: () => ipcRenderer.send("card:snooze"),
  hideCard: () => ipcRenderer.send("card:hidden"),
});
