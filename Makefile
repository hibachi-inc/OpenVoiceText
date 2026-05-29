APP_NAME = VoiceFlow
BUILD_DIR = .build/debug
APP_BUNDLE = $(BUILD_DIR)/$(APP_NAME).app

.PHONY: build bundle run clean

build:
	swift build

bundle: build
	# Main app
	mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	cp "$(BUILD_DIR)/VoiceFlowApp" "$(APP_BUNDLE)/Contents/MacOS/VoiceFlowApp"
	cp "Resources/Info.plist" "$(APP_BUNDLE)/Contents/"

	# STT XPC Service
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/MacOS"
	cp "$(BUILD_DIR)/VoiceFlowSTT" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/MacOS/VoiceFlowSTT"
	cp "Resources/STT-Info.plist" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/Info.plist"

	# Refiner XPC Service
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS"
	cp "$(BUILD_DIR)/VoiceFlowRefiner" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS/VoiceFlowRefiner"
	cp "Resources/Refiner-Info.plist" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/Info.plist"

	# Ad-hoc sign everything
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc"
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc"
	codesign --force --sign - "$(APP_BUNDLE)"

run: bundle
	open "$(APP_BUNDLE)"

clean:
	swift package clean
	rm -rf "$(APP_BUNDLE)"
