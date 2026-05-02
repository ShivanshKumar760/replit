import { KubeConfig, CoreV1Api, AppsV1Api } from "@kubernetes/client-node";

let kc: KubeConfig;
let coreApi: CoreV1Api;
let appsApi: AppsV1Api;

export const initK8s = (): void => {
  kc = new KubeConfig();
  kc.loadFromDefault();

  coreApi = kc.makeApiClient(CoreV1Api);
  appsApi = kc.makeApiClient(AppsV1Api);

  console.log("Kubernetes client initialized");
};

export const getKubeConfig = (): KubeConfig => kc;
export const getCoreApi = (): CoreV1Api => coreApi;
export const getAppsApi = (): AppsV1Api => appsApi;
