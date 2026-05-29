OSS_DIR = OpenVoiceText
PRO_BUILD_DIR = .build/arm64-apple-macosx/debug
APP_BUNDLE = .build/OpenVoiceText-Pro.app

.PHONY: build bundle run clean

build:
	cd $(OSS_DIR) && make bundle
	swift build

bundle: build
	# Start from OSS bundle
	rm -rf "$(APP_BUNDLE)"
	cp -R "$(OSS_DIR)/.build/debug/VoiceFlow.app" "$(APP_BUNDLE)"

	# Replace Refiner XPC with Pro version
	rm -rf "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc"
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS"
	cp "$(PRO_BUILD_DIR)/ProRefiner" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS/ProRefiner"
	cp "ProResources/Refiner-Info.plist" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/Info.plist"

	# Ad-hoc sign
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc"
	codesign --force --sign - "$(APP_BUNDLE)"

run: bundle
	open "$(APP_BUNDLE)"

clean:
	swift package clean
	cd $(OSS_DIR) && make clean
	rm -rf "$(APP_BUNDLE)"
