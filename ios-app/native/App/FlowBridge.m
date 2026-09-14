#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(FlowBridge, "FlowBridge",
  CAP_PLUGIN_METHOD(setToken, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(status,   CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(clear,    CAPPluginReturnPromise);
)
